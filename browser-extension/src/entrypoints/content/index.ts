import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { ADAPTERS, adapterFor, KNOWN_ATS_MATCHES } from '@/lib/autofill/adapters';
import { applyAnswers, countFormFields, runAutofill } from '@/lib/autofill/engine';
import { extractJobDeep } from '@/lib/extract/job';
import type { AutofillReport, BackgroundRequest, BackgroundResponse, ContentRequest, PageScan } from '@/lib/messages';
import { answerBankStore, profileStore, settingsStore } from '@/lib/storage';
import type { ExtensionProfile, FlatCv, ScreeningAnswer } from '@/lib/types';
import { mountInPageButton } from './button';

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
    const w = window as unknown as { __hustlenLoaded?: boolean };
    if (w.__hustlenLoaded) return;
    w.__hustlenLoaded = true;
    void ADAPTERS; // keep adapters in this bundle

    const send = <T>(msg: BackgroundRequest) => browser.runtime.sendMessage(msg) as Promise<BackgroundResponse<T>>;
    const adapter = () => adapterFor(new URL(location.href));

    async function loadProfile(): Promise<ExtensionProfile | null> {
      const cached = await profileStore.getValue().catch(() => null);
      if (cached?.profile) return cached.profile;
      const res = await send<ExtensionProfile>({ type: 'profile:get' });
      return res.ok ? res.data : null;
    }

    let sticky: MutationObserver | null = null;
    // One fetch per page: sticky re-runs (new "Add another" blocks) reuse it.
    let tailoredCv: Promise<{ cv: FlatCv; reviewed: boolean } | null> | null = null;
    let running = false;

    async function autofill(useAi?: boolean): Promise<AutofillReport | { error: string }> {
      if (running) return { error: 'Autofill already running' };
      running = true;
      try {
        const [profile, answers, settings] = await Promise.all([loadProfile(), answerBankStore.getValue(), settingsStore.getValue()]);
        if (!profile) return { error: 'Connect the extension to hustlen.ai first' };
        const a = adapter();
        if (countFormFields(a) === 0) {
          return { error: 'No application form on this page yet. Open the form (e.g. click "Apply") and try again.' };
        }
        const report = await runAutofill({ profile, answers }, a, document, {
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

    browser.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
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
      if (msg.type === 'page:applyAnswers') {
        applyAnswers(msg.answers).then(sendResponse);
        return true;
      }
    });

    // In-page "Autofill" button, only where an application form is present.
    void (async () => {
      const settings = await settingsStore.getValue();
      if (!settings.showInPageButton) return;
      const check = () => countFormFields(adapter()) >= 3;
      const mount = () => mountInPageButton(() => autofill());
      if (check()) {
        mount();
        return;
      }
      // Many boards open the form later, in a modal or a new step (e.g. after
      // "Apply now"), so keep watching - debounced, and only until it mounts.
      let pending: number | undefined;
      const obs = new MutationObserver(() => {
        clearTimeout(pending);
        pending = window.setTimeout(() => {
          if (check()) {
            obs.disconnect();
            mount();
          }
        }, 300);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    })();
  },
});
