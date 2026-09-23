import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ApiError, HustlenApi } from '@/lib/api';
import { AuthError, connect, disconnect, getAccessToken, isConnected } from '@/lib/auth';
import { PROFILE_TTL_MS } from '@/lib/config';
import type { AutofillReport, BackgroundRequest, BackgroundResponse, ContentRequest, PageScan } from '@/lib/messages';
import { profileStore, settingsStore } from '@/lib/storage';
import type { ExtensionProfile } from '@/lib/types';

const api = new HustlenApi((force) => getAccessToken(force));

async function getProfile(refresh = false): Promise<ExtensionProfile> {
  const cached = await profileStore.getValue();
  if (!refresh && cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return cached.profile;
  const settings = await settingsStore.getValue();
  let profile: ExtensionProfile;
  try {
    profile = await api.getProfile(settings.selectedCvSource);
  } catch (e) {
    // The selected CV was deleted in the web app: fall back to the default one.
    if (e instanceof ApiError && e.status === 404 && settings.selectedCvSource) {
      await settingsStore.setValue({ ...settings, selectedCvSource: null });
      profile = await api.getProfile(null);
    } else throw e;
  }
  await profileStore.setValue({ profile, fetchedAt: Date.now() });
  return profile;
}

/** Makes sure the content script runs in the tab (declared hosts already have it; others via activeTab). */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'page:scan' } satisfies ContentRequest);
    return;
  } catch {
    /* not injected yet */
  }
  await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['/content-scripts/content.js'] }).catch(() =>
    browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] }),
  );
}

async function handle(msg: BackgroundRequest): Promise<unknown> {
  switch (msg.type) {
    case 'auth:status':
      return { connected: await isConnected() };
    case 'auth:connect':
      await connect();
      getProfile(true).catch(() => undefined); // warm the cache so the first autofill is instant
      return { connected: true };
    case 'auth:disconnect':
      await disconnect();
      return { connected: false };
    case 'auth:token':
      return getAccessToken(msg.force);
    case 'profile:get':
      return getProfile(msg.refresh);
    case 'profile:selectCv': {
      const settings = await settingsStore.getValue();
      await settingsStore.setValue({ ...settings, selectedCvSource: msg.cvSource });
      return getProfile(true);
    }
    case 'app:lookup':
      return api.lookupApplication(msg.url);
    case 'app:save': {
      const existing = await api.lookupApplication(msg.job.url);
      if (existing.found) return { application_id: existing.application_id, existing: true };
      const created = await api.createApplication(msg.job);
      return { application_id: created.application_id, existing: false };
    }
    case 'app:markSubmitted':
      return api.setStatus(msg.applicationId, 'Submitted');
    case 'ai:answer': {
      const settings = await settingsStore.getValue();
      const res = await api.answerQuestions({
        questions: msg.questions,
        cv_source: settings.selectedCvSource,
        application_id: msg.applicationId ?? undefined,
        job_title: msg.job?.title,
        company_name: msg.job?.company,
        job_description: msg.job?.description?.slice(0, 20000),
      });
      return res.answers;
    }
    case 'tab:scan':
      await ensureContentScript(msg.tabId);
      return (await browser.tabs.sendMessage(msg.tabId, { type: 'page:scan' } satisfies ContentRequest)) as PageScan;
    case 'tab:autofill':
      await ensureContentScript(msg.tabId);
      return (await browser.tabs.sendMessage(msg.tabId, { type: 'page:autofill', useAi: msg.useAi } satisfies ContentRequest)) as AutofillReport;
  }
}

export default defineBackground(() => {
  // Content scripts read the cached profile from session storage directly (Chrome).
  (browser.storage.session as any)?.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch?.(() => undefined);

  // Toolbar click opens the side panel (Chrome/Edge); Firefox uses its sidebar.
  (browser as any).sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch?.(() => undefined);
  if (!(browser as any).sidePanel && (browser as any).sidebarAction) {
    browser.action.onClicked.addListener(() => (browser as any).sidebarAction.open());
  }

  browser.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
    handle(msg)
      .then((data) => sendResponse({ ok: true, data } satisfies BackgroundResponse))
      .catch((e: unknown) => {
        const err = e as ApiError | AuthError | Error;
        sendResponse({
          ok: false,
          error: err.message || 'Something went wrong',
          code: err instanceof ApiError ? err.code : undefined,
          status: err instanceof ApiError ? err.status : undefined,
        } satisfies BackgroundResponse);
      });
    return true;
  });

  // Alt+Shift+F: autofill the current tab without opening anything.
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'autofill') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    await handle({ type: 'tab:autofill', tabId: tab.id }).catch(() => undefined);
  });

  browser.runtime.onStartup.addListener(async () => {
    if (await isConnected()) getProfile(true).catch(() => undefined);
  });
});
