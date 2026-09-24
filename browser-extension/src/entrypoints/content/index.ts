import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { ADAPTERS, adapterFor, KNOWN_ATS_MATCHES } from '@/lib/autofill/adapters';
import { applyAnswers, countFormFields, runAutofill } from '@/lib/autofill/engine';
import { extractJobDeep } from '@/lib/extract/job';
import type { AutofillReport, BackgroundRequest, BackgroundResponse, ContentRequest, PageScan } from '@/lib/messages';
import { extensionAlive, safely } from '@/lib/context';
import { currentTranslator, translator } from '@/lib/i18n';
import { looksLikeJobContext, siteBlockReason } from '@/lib/sites';
import { answerBankStore, learnedStore, profileStore, settingsStore, type LearnedCandidate } from '@/lib/storage';
import type { ExtensionProfile, FlatCv, ScreeningAnswer } from '@/lib/types';
import { mountInPageButton, showPrompt } from './button';
import { captureAnswers, mergePending, newToBank, saveToBank, stepOf } from '@/lib/autofill/learn';
import type { ResumeFile } from '@/lib/autofill/engine';

/**
 * Runs in job pages (statically on known ATS hosts, or injected on demand
 * via activeTab on any other site). Autofill reads the cached profile
 * straight from extension storage - no background round trip, no network.
 */
export default defineContentScript({
  matches: KNOWN_ATS_MATCHES,
  allFrames: true,
  runAt: 'document_idle',
  main() {
    // One live instance per frame. A previous copy orphaned by an extension
    // reload/update is told to tear down, and this fresh one takes over.
    const w = window as unknown as { __hustlen?: { alive: () => boolean; teardown: () => void } };
    if (!extensionAlive()) return;
    if (w.__hustlen?.alive()) return;
    w.__hustlen?.teardown();
    void ADAPTERS; // keep adapters in this bundle

    const observers = new Set<MutationObserver>();
    let buttonHost: HTMLElement | null = null;
    let dead = false;
    const teardown = () => {
      if (dead) return;
      dead = true;
      observers.forEach((o) => o.disconnect());
      observers.clear();
      buttonHost?.remove();
    };
    w.__hustlen = { alive: () => !dead && extensionAlive(), teardown };
    const guard = <T,>(fn: () => Promise<T>, fallback: T) => safely(fn, fallback, teardown);

    const send = <T,>(msg: BackgroundRequest) =>
      guard(() => browser.runtime.sendMessage(msg) as Promise<BackgroundResponse<T>>, { ok: false, error: 'extension_reloaded' } as BackgroundResponse<T>);
    const adapter = () => adapterFor(new URL(location.href));

    async function loadProfile(): Promise<ExtensionProfile | null> {
      const cached = await guard(() => profileStore.getValue(), null).catch(() => null);
      if (cached?.profile) return cached.profile;
      const res = await send<ExtensionProfile>({ type: 'profile:get' });
      return res.ok ? res.data : null;
    }

    let sticky: MutationObserver | null = null;
    // One fetch per page: sticky re-runs (new "Add another" blocks) reuse it.
    let tailoredCv: Promise<{ cv: FlatCv; reviewed: boolean } | null> | null = null;
    let running = false;

    async function autofill(useAi?: boolean): Promise<AutofillReport | { error: string }> {
      const t = await guard(() => currentTranslator(), translator('en'));
      if (dead) return { error: 'extension_reloaded' };
      if (running) return { error: t('ERR_AUTOFILL_RUNNING') };
      running = true;
      try {
        const [profile, answers, settings] = await Promise.all([
          loadProfile(),
          guard(() => answerBankStore.getValue(), null),
          guard(() => settingsStore.getValue(), null),
        ]);
        if (dead || !answers || !settings) return { error: 'extension_reloaded' };
        if (!profile) return { error: t('ERR_NOT_CONNECTED') };
        const a = adapter();
        if (countFormFields(a) === 0) {
          return { error: t('ERR_NO_FORM_YET') };
        }
        const report = await runAutofill({ profile, answers }, a, document, {
          // "Upload your resume": the job's reviewed tailored CV, else the Master CV (no AI - free).
          getResumeFile: async () => {
            const job = await extractJobDeep(document, new URL(location.href), a);
            const res = await send<ResumeFile | null>({ type: 'app:resumeFile', url: job?.url ?? location.href });
            return res.ok ? res.data : null;
          },
          getTailoredCv: () => (tailoredCv ??= (async () => {
            const job = await extractJobDeep(document, new URL(location.href), a);
            if (!job) return null;
            const res = await send<{ cv: FlatCv; reviewed: boolean } | null>({ type: 'app:tailoredCv', url: job.url });
            return res.ok ? res.data : null;
          })()),
          // Only fetched when the form asks for the cover letter as TEXT (not an upload).
          getCoverLetter: async () => {
            const job = await extractJobDeep(document, new URL(location.href), a);
            if (!job) return null;
            const res = await send<{ text: string; reviewed: boolean } | null>({ type: 'app:coverLetterText', url: job.url });
            return res.ok ? res.data : null;
          },
        });

        const wantAi = useAi ?? settings.useAiForOpenQuestions;
        if (wantAi && report.unanswered.length) {
          const job = await extractJobDeep(document, new URL(location.href), a);
          const res = await send<ScreeningAnswer[]>({ type: 'ai:answer', questions: report.unanswered.slice(0, 25), job: job ?? undefined });
          if (!res.ok && res.status === 402) report.aiSkipped = 'credits';
          if (res.ok) {
            const { applied, review } = await applyAnswers(res.data);
            report.aiAnswered = applied;
            report.needsReview.push(...res.data.filter((x) => x.needs_review).map((x) => report.unanswered.find((q) => q.id === x.id)?.label || x.id));
            report.unanswered = report.unanswered.filter((q) => !res.data.some((x) => x.id === q.id && x.answer));
            void review;
          }
        }
        startSticky();
        // A new "Add another" block was opened: fill it on the next pass.
        if (report.sectionsAdded) setTimeout(() => void autofill(), 500);
        return report;
      } finally {
        running = false;
      }
    }

    /** Multi-step forms (Workday, LinkedIn Easy Apply): fill each new step as it renders. */
    function startSticky() {
      if (sticky) return;
      let timer: number | undefined;
      const stopAt = Date.now() + 15 * 60 * 1000;
      sticky = new MutationObserver((mutations) => {
        if (!extensionAlive()) return teardown();
        if (Date.now() > stopAt) {
          sticky?.disconnect();
          sticky = null;
          return;
        }
        const addedControls = mutations.some((m) =>
          Array.from(m.addedNodes).some((n) => n instanceof HTMLElement && !n.closest('[data-hustlen-ui]') && (n.matches('input, select, textarea') || n.querySelector('input, select, textarea'))),
        );
        if (!addedControls) return;
        clearTimeout(timer);
        timer = window.setTimeout(() => void autofill(), 400);
      });
      sticky.observe(document.body, { childList: true, subtree: true });
      observers.add(sticky);
    }

    async function scan(): Promise<PageScan> {
      const a = adapter();
      const count = countFormFields(a);
      return {
        job: await extractJobDeep(document, new URL(location.href), a),
        platform: a.name,
        formFieldCount: count,
        hasApplicationForm: count >= 3,
      };
    }

    // Own/local/non-job/paused sites: stay silent (no button, no autofill).
    let blocked: ReturnType<typeof siteBlockReason> = siteBlockReason(location.href);
    void guard(() => settingsStore.getValue(), null).then((s) => {
      if (s) blocked = siteBlockReason(location.href, s.pausedSites ?? []);
    });

    browser.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
      if (blocked) {
        if (window === window.top) sendResponse(msg.type === 'page:scan' ? { blocked, job: null, platform: '', formFieldCount: 0, hasApplicationForm: false } : { error: 'blocked' });
        return;
      }
      if (msg.type === 'page:scan') {
        // Only the top frame, or an iframe that actually holds a form, answers.
        if (window !== window.top && countFormFields(adapter()) < 3) return;
        scan().then(sendResponse);
        return true;
      }
      if (msg.type === 'page:autofill') {
        if (window !== window.top && countFormFields(adapter()) < 2) return;
        autofill(msg.useAi).then(sendResponse);
        return true;
      }
      if (msg.type === 'page:captureAnswers') {
        if (window !== window.top && countFormFields(adapter()) < 2) return;
        learnFromPage('manual').then(sendResponse);
        return true;
      }
      if (msg.type === 'page:applyAnswers') {
        applyAnswers(msg.answers).then(sendResponse);
        return true;
      }
    });

    // ---------------------------------------------------------------- answer learning
    // Answers the user types (or corrects) are read at "Next"/"Submit" and,
    // with their consent, offered for saving so the next form fills them.
    // Nothing is kept until the user opted in (see lib/autofill/learn.ts).
    let unconsented: LearnedCandidate[] = [];

    async function learnFromPage(kind: 'next' | 'submit' | 'manual'): Promise<LearnedCandidate[]> {
      if (dead || blocked) return [];
      const [settings, bank] = await Promise.all([guard(() => settingsStore.getValue(), null), guard(() => answerBankStore.getValue(), null)]);
      if (!settings || !bank || settings.learnAnswers === false) return [];
      if (kind !== 'manual' && !looksLikeJobContext(document, location.href)) return [];
      const fresh = newToBank(captureAnswers(adapter()), bank);
      if (settings.learnAnswers === null) {
        // Not opted in yet: keep only in this page's memory and ask at submit.
        unconsented = mergePending(unconsented, fresh);
        if (kind === 'submit' && unconsented.length) askToRemember(unconsented.length);
        return unconsented;
      }
      const pending = mergePending((await guard(() => learnedStore.getValue(), [])) ?? [], fresh);
      await guard(() => learnedStore.setValue(pending), undefined);
      const here = pending.filter((p) => p.host === location.hostname);
      if (kind === 'submit' && here.length) askToSave(here);
      return here;
    }

    async function saveCandidates(items: LearnedCandidate[]) {
      const bank = await guard(() => answerBankStore.getValue(), null);
      if (!bank) return;
      await guard(() => answerBankStore.setValue(saveToBank(bank, items)), undefined);
      const ids = new Set(items.map((i) => i.id));
      const rest = ((await guard(() => learnedStore.getValue(), [])) ?? []).filter((p) => !ids.has(p.id));
      await guard(() => learnedStore.setValue(rest), undefined);
    }

    async function askToSave(items: LearnedCandidate[]) {
      const t = await guard(() => currentTranslator(), translator('en'));
      showPrompt({
        title: t('LEARN_SAVE_TITLE', { count: items.length }),
        body: t('LEARN_SAVE_BODY'),
        primary: t('LEARN_SAVE'),
        secondary: t('LEARN_LATER'),
        onPrimary: () => saveCandidates(items),
      });
    }

    async function askToRemember(count: number) {
      const t = await guard(() => currentTranslator(), translator('en'));
      showPrompt({
        title: t('LEARN_OPTIN_TITLE', { count }),
        body: t('LEARN_OPTIN_BODY'),
        primary: t('LEARN_OPTIN_YES'),
        secondary: t('LEARN_OPTIN_NO'),
        onPrimary: async () => {
          const settings = await guard(() => settingsStore.getValue(), null);
          if (!settings) return;
          await guard(() => settingsStore.setValue({ ...settings, learnAnswers: true }), undefined);
          await saveCandidates(unconsented);
          unconsented = [];
        },
        onSecondary: async () => {
          const settings = await guard(() => settingsStore.getValue(), null);
          if (settings) await guard(() => settingsStore.setValue({ ...settings, learnAnswers: false }), undefined);
          unconsented = [];
        },
      });
    }

    // Capture phase: runs before the page's own handler tears the step down.
    document.addEventListener(
      'click',
      (e) => {
        const kind = stepOf(e.target);
        if (kind && extensionAlive()) void learnFromPage(kind);
      },
      true,
    );
    document.addEventListener('submit', () => extensionAlive() && void learnFromPage('submit'), true);

    // In-page "Autofill" button, only where an application form is present.
    void (async () => {
      const settings = await guard(() => settingsStore.getValue(), null);
      if (!settings || !settings.showInPageButton || siteBlockReason(location.href, settings.pausedSites ?? [])) return;
      // An application form, on a page that actually looks like a job context
      // (not a checkout, sign-up or contact form).
      const check = () => countFormFields(adapter()) >= 3 && looksLikeJobContext(document, location.href);
      const t = await guard(() => currentTranslator(), translator('en'));
      if (dead) return;
      const mount = () => {
        buttonHost = mountInPageButton(() => autofill(), t);
      };
      if (check()) {
        mount();
        return;
      }
      // Many boards open the form later, in a modal or a new step (e.g. after
      // "Apply now"), so keep watching - debounced, and only until it mounts.
      let pending: number | undefined;
      const obs = new MutationObserver(() => {
        if (!extensionAlive()) return teardown();
        clearTimeout(pending);
        pending = window.setTimeout(() => {
          if (check()) {
            obs.disconnect();
            mount();
          }
        }, 300);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      observers.add(obs);
    })();
  },
});
