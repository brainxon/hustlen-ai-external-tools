import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { APP_BASE_URL } from '@/lib/config';
import type { AutofillReport, PageScan } from '@/lib/messages';
import { storage } from 'wxt/utils/storage';
import type { ApplicationLookup, DocumentKind, DocumentStatus, ExtensionProfile, PlanSummary } from '@/lib/types';
import logoSvg from '@/assets/logo.svg?raw';
import { useT, type MessageKey } from '@/lib/i18n';
import { siteKey } from '@/lib/sites';
import { AnswerBankView } from './AnswerBank';
import { activeTab, call, panelApi } from './bridge';

type Tab = 'apply' | 'answers';
type Busy = null | 'connect' | 'autofill' | 'save' | 'tailor' | 'submit' | 'cv' | 'download';

interface TailorStep {
  label: string;
  done: boolean;
}

/** Tailoring runs in flight, per application - survives closing/reopening the panel. */
const inFlight = storage.defineItem<Record<string, number>>('session:tailoringInFlight', { fallback: {} });
const IN_FLIGHT_TTL_MS = 15 * 60 * 1000;

async function markInFlight(appId: number, on: boolean) {
  const all = await inFlight.getValue();
  if (on) all[appId] = Date.now();
  else delete all[appId];
  await inFlight.setValue(all);
}

async function isInFlight(appId: number): Promise<boolean> {
  const started = (await inFlight.getValue())[appId];
  return !!started && Date.now() - started < IN_FLIGHT_TTL_MS;
}

const Logo = () => <span class="logo" dangerouslySetInnerHTML={{ __html: logoSvg }} />;

export function App() {
  const { t } = useT();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('apply');
  const [profile, setProfile] = useState<ExtensionProfile | null>(null);
  const [scan, setScan] = useState<PageScan | null>(null);
  const [lookup, setLookup] = useState<ApplicationLookup | null>(null);
  const [report, setReport] = useState<AutofillReport | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [steps, setSteps] = useState<TailorStep[]>([]);
  const [tailorDone, setTailorDone] = useState<number | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [upgradeNeeded, setUpgradeNeeded] = useState(false);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const tabId = useRef<number | null>(null);
  const tailorAbort = useRef<AbortController | null>(null);

  const run = useCallback(async <T,>(kind: Busy, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    setUpgradeNeeded(false);
    try {
      return await fn();
    } catch (e: any) {
      if (e?.status === 401 || e?.code === 'not_connected') setConnected(false);
      // Plan limits (AI credits, missing capability, quota): a clear message + upgrade, not a raw error.
      if (e?.status === 402 || ['token_credits_exceeded', 'capability_missing', 'limit_reached', 'lifetime_limit_reached', 'template_not_allowed'].includes(e?.code)) {
        setUpgradeNeeded(true);
        setError(t('LIMIT_REACHED'));
        refreshPlan();
      } else {
        setError(e?.message || t('GENERIC_ERROR'));
      }
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshPlan = () => {
    call<PlanSummary>({ type: 'plan:get' }).then(setPlan).catch(() => undefined);
  };

  const refreshPage = useCallback(async () => {
    const t = await activeTab();
    tabId.current = t?.id ?? null;
    setPageUrl(t?.url ?? null);
    setReport(null);
    setSteps([]);
    setTailorDone(null);
    setNeedsAccess(false);
    if (t?.id == null || !/^https?:/.test(t.url || '')) {
      setScan(null);
      setLookup(null);
      return;
    }
    try {
      const s = await call<PageScan>({ type: 'tab:scan', tabId: t.id });
      setScan(s);
      setLookup(s?.job && !s.blocked ? await call<ApplicationLookup>({ type: 'app:lookup', url: s.job.url }).catch(() => null) : null);
    } catch (e: any) {
      setScan(null); // restricted page (store, settings, PDF viewer) or no access yet
      setLookup(null);
      setNeedsAccess(e?.code === 'no_site_access');
    }
  }, []);

  useEffect(() => {
    call<{ connected: boolean }>({ type: 'auth:status' }).then((s) => setConnected(s.connected));
  }, []);

  useEffect(() => {
    if (!connected) return;
    call<ExtensionProfile>({ type: 'profile:get' }).then(setProfile).catch((e) => setError(e.message));
    refreshPlan();
    refreshPage();
    const onActivated = () => refreshPage();
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId.current && info.status === 'complete') refreshPage();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [connected, refreshPage]);

  const connect = () =>
    run('connect', async () => {
      await call({ type: 'auth:connect' });
      setConnected(true);
    });

  const disconnect = async () => {
    await call({ type: 'auth:disconnect' });
    setProfile(null);
    setConnected(false);
  };

  const autofill = () =>
    run('autofill', async () => {
      if (tabId.current == null) throw new Error(t('ERR_OPEN_APPLICATION'));
      const r = await call<AutofillReport | { error: string }>({ type: 'tab:autofill', tabId: tabId.current });
      if (!r) throw new Error(t('ERR_NO_FORM'));
      if ('error' in r) throw new Error(r.error);
      setReport(r);
      if (r.aiSkipped === 'credits') {
        setNotice(t('AI_SKIPPED_CREDITS'));
        setUpgradeNeeded(true);
      } else if (r.coverLetter === 'missing') setNotice(t('COVER_LETTER_MISSING'));
      if (r.aiAnswered) refreshPlan();
    });

  const save = async (): Promise<number | null> => {
    if (lookup?.found && lookup.application_id) return lookup.application_id;
    if (!scan?.job) {
      setError(t('ERR_NO_JOB'));
      return null;
    }
    const res = await run('save', () => call<ApplicationLookup & { existing: boolean }>({ type: 'app:save', job: scan.job! }));
    if (!res?.application_id) return null;
    setLookup({ ...res, found: true });
    setNotice(res.existing ? t('NOTICE_ALREADY_SAVED') : t('NOTICE_SAVED'));
    return res.application_id;
  };

  const refreshDocuments = async (appId: number) => {
    const docs = await panelApi.documentStatus(appId).catch(() => null);
    if (docs) setLookup((l) => (l ? { ...l, ...docs } : l));
  };

  const tailor = async (force = false) => {
    const appId = await save();
    if (!appId || !profile) return;
    // Never run the pipeline twice by accident: an existing tailored CV stays
    // (re-tailoring is an explicit, confirmed action), and a run already in
    // flight for this job blocks a second one.
    if (await isInFlight(appId)) {
      setError(t('ERR_TAILOR_RUNNING'));
      return;
    }
    const docs: DocumentStatus | null = lookup?.cv_available ? (lookup as DocumentStatus) : await panelApi.documentStatus(appId).catch(() => null);
    if (docs?.cv_available && !force) {
      setLookup((l) => (l ? { ...l, ...docs } : l));
      setNotice(t('NOTICE_ALREADY_TAILORED'));
      return;
    }
    const source = profile.cv_sources.find((s) => s.key === (profile.cv?.source_key ?? '')) ?? profile.cv_sources.find((s) => s.is_default);
    if (!source) {
      setError(t('ERR_NO_MASTER_CV'));
      return;
    }
    tailorAbort.current = new AbortController();
    setSteps([]);
    setTailorDone(null);
    await markInFlight(appId, true);
    await run('tailor', async () => {
      // Jobs saved from the extension get their keywords/language extracted
      // here, only once and only if missing (credit-gated on the backend).
      setSteps([{ label: t('PREPARING'), done: false }]);
      await panelApi.prepareForTailoring(appId);
      setSteps([{ label: t('PREPARING'), done: true }]);
      return panelApi.streamTailor(
        appId,
        source.kind === 'root' ? { root_cv_language: source.root_cv_language } : { user_cv_id: source.user_cv_id },
        (ev) => {
          if (ev.type === 'progress') setSteps((prev) => [...prev.map((s) => ({ ...s, done: true })), { label: ev.label || ev.node, done: false }]);
          if (ev.type === 'complete') {
            setSteps((prev) => prev.map((s) => ({ ...s, done: true })));
            setTailorDone(appId);
          }
          if (ev.type === 'error') throw new Error(ev.message || t('ERR_TAILOR_FAILED'));
        },
        tailorAbort.current?.signal,
      );
    });
    await markInFlight(appId, false);
    await refreshDocuments(appId);
    refreshPlan();
  };

  const retailor = () => {
    if (window.confirm(t('CONFIRM_RETAILOR'))) {
      void tailor(true);
    }
  };

  const download = (kind: DocumentKind) =>
    run('download', async () => {
      if (!lookup?.application_id) return;
      const { blob, filename } = await panelApi.downloadDocument(lookup.application_id, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  const markSubmitted = () =>
    run('submit', async () => {
      const appId = await save();
      if (!appId) return;
      await call({ type: 'app:markSubmitted', applicationId: appId });
      setLookup((l) => (l ? { ...l, status: 'Submitted' } : l));
      setNotice(t('NOTICE_SUBMITTED'));
    });

  const selectCv = (key: string) =>
    run('cv', async () => {
      setProfile(await call<ExtensionProfile>({ type: 'profile:selectCv', cvSource: key }));
    });

  // Must run in the panel itself: permissions.request needs the click's user gesture.
  const grantAllSites = async () => {
    const granted = await browser.permissions.request({ origins: ['https://*/*', 'http://*/*'] }).catch(() => false);
    if (granted) refreshPage();
  };

  const setSitePaused = async (paused: boolean) => {
    if (!pageUrl) return;
    await call({ type: 'site:pause', url: pageUrl, paused });
    refreshPage();
  };

  const openInApp = (appId: number) => browser.tabs.create({ url: `${APP_BASE_URL}/home/quick-application?applicationId=${appId}` });

  if (connected === null) return <div class="shell center"><div class="spinner" aria-label={t('LOADING')} /></div>;

  if (!connected) {
    return (
      <div class="shell onboarding">
        <header class="brand"><Logo /><span>hustlen.ai</span></header>
        <h1>{t('HERO_TITLE_1')}<br /><em>{t('HERO_TITLE_2')}</em></h1>
        <p class="lead">{t('HERO_LEAD')}</p>
        <ul class="features">
          <li><span class="dot">⚡</span>{t('FEATURE_AUTOFILL')}</li>
          <li><span class="dot">✦</span>{t('FEATURE_ANSWERS')}</li>
          <li><span class="dot">◎</span>{t('FEATURE_TRACK')}</li>
        </ul>
        <button class="btn primary block" onClick={connect} disabled={busy === 'connect'}>
          {busy === 'connect' ? t('CONNECTING') : t('CONNECT')}
        </button>
        <p class="fine">{t('CONNECT_HINT')}</p>
        {error && <p class="alert" role="alert">{error}</p>}
      </div>
    );
  }

  const blocked = scan?.blocked;
  const site = pageUrl ? siteKey(pageUrl) : '';
  const job = blocked ? null : scan?.job;
  const saved = lookup?.found ? lookup : null;
  const currentCv = profile?.cv_sources.find((s) => s.key === profile.cv?.source_key);

  return (
    <div class="shell">
      <header class="topbar">
        <div class="brand"><Logo /><span>hustlen.ai</span></div>
        <nav class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'apply'} class={tab === 'apply' ? 'active' : ''} onClick={() => setTab('apply')}>{t('TAB_APPLY')}</button>
          <button role="tab" aria-selected={tab === 'answers'} class={tab === 'answers' ? 'active' : ''} onClick={() => setTab('answers')}>{t('TAB_ANSWERS')}</button>
        </nav>
      </header>

      {tab === 'answers' ? (
        <AnswerBankView />
      ) : (
        <main class="stack">
          <section class="card job">
            {job ? (
              <>
                <div class="row between">
                  <span class="badge">{scan?.platform}</span>
                  {saved ? <span class={`status s-${(saved.status || 'pending').toLowerCase()}`}>{t(`STATUS_${(saved.status || 'pending').toUpperCase()}` as MessageKey)}</span> : <span class="status muted">{t('NOT_SAVED')}</span>}
                </div>
                <h2 class="job-title">{job.title || t('UNTITLED_POSITION')}</h2>
                <p class="job-meta">{[job.company, job.location].filter(Boolean).join(' · ') || t('COMPANY_NOT_DETECTED')}</p>
              </>
            ) : blocked ? (
              <>
                <h2 class="job-title">{t('SITE_OFF_TITLE')}</h2>
                <p class="job-meta">
                  {blocked === 'own' ? t('SITE_OFF_OWN') : blocked === 'local' ? t('SITE_OFF_LOCAL') : blocked === 'paused' ? t('SITE_OFF_PAUSED', { site }) : t('SITE_OFF_NONJOB')}
                </p>
                {blocked === 'paused' && <button class="btn block access" onClick={() => setSitePaused(false)}>{t('RESUME_SITE', { site })}</button>}
              </>
            ) : needsAccess ? (
              <>
                <h2 class="job-title">{t('ALLOW_TITLE')}</h2>
                <p class="job-meta">{t('ALLOW_TEXT')}</p>
                <button class="btn primary block access" onClick={grantAllSites}>{t('ALLOW_BUTTON')}</button>
                <p class="fine">{t('ALLOW_ALT')}</p>
              </>
            ) : (
              <>
                <h2 class="job-title">{t('NO_JOB_TITLE')}</h2>
                <p class="job-meta">{scan?.hasApplicationForm ? t('NO_JOB_HAS_FORM') : t('NO_JOB_TEXT')}</p>
              </>
            )}
          </section>

          <section class="actions">
            <button class="btn primary big" onClick={autofill} disabled={!!busy || !scan || !!blocked}>
              <span>{busy === 'autofill' ? t('FILLING') : t('AUTOFILL')}</span>
              <kbd>⌥⇧F</kbd>
            </button>
            <div class="grid">
              <button class="btn" onClick={save} disabled={!!busy || !job || !!saved}>{busy === 'save' ? t('SAVING') : saved ? t('SAVED') : t('SAVE_JOB')}</button>
              {saved?.cv_available ? (
                <button class="btn done" onClick={() => saved.application_id && openInApp(saved.application_id)} disabled={!!busy} title={t('TAILORED_TITLE')}>{t('TAILORED')}</button>
              ) : (
                <button class="btn" onClick={() => tailor()} disabled={!!busy || !job}>{busy === 'tailor' ? t('TAILORING') : t('TAILOR')}</button>
              )}
              <button class="btn" onClick={markSubmitted} disabled={!!busy || !job || saved?.status === 'Submitted'}>{saved?.status === 'Submitted' ? t('SUBMITTED') : t('MARK_APPLIED')}</button>
              <button class="btn" onClick={() => saved?.application_id && openInApp(saved.application_id)} disabled={!saved?.application_id}>{t('OPEN_IN_APP')}</button>
            </div>
          </section>

          {notice && <p class="notice" role="status">{notice}</p>}
          {error && <p class="alert" role="alert">{error}</p>}
          {upgradeNeeded && (
            <button class="btn primary block" onClick={() => browser.tabs.create({ url: `${APP_BASE_URL}/home/plans` })}>{t('UPGRADE')}</button>
          )}

          {report && (
            <section class="card report">
              <div class="stats">
                <div><strong>{report.filled + report.aiAnswered}</strong><span>{t('STAT_FILLED')}</span></div>
                <div><strong>{report.needsReview.length}</strong><span>{t('STAT_REVIEW')}</span></div>
                <div><strong>{report.unanswered.length}</strong><span>{t('STAT_LEFT')}</span></div>
                <div><strong>{report.durationMs}ms</strong><span>{t('STAT_LOCAL')}</span></div>
              </div>
              {report.needsReview.length > 0 && (
                <details>
                  <summary>{t('REVIEW_FIELDS')}</summary>
                  <ul>{report.needsReview.map((l) => <li key={l}>{l}</li>)}</ul>
                </details>
              )}
              <p class="fine">{t('CHECK_BEFORE_SUBMIT')}</p>
            </section>
          )}

          {steps.length > 0 && (
            <section class="card steps" aria-live="polite">
              <h3>{t('TAILORING_TITLE')}</h3>
              <ol>{steps.map((s, i) => <li key={i} class={s.done ? 'done' : 'active'}>{s.label}</li>)}</ol>
              {tailorDone && <p class="fine">{t('TAILOR_DONE')}</p>}
            </section>
          )}

          {saved?.application_id && (saved.cv_available || saved.cover_letter_available) && (
            <section class="card docs">
              <h3>{t('DOCS_TITLE')}</h3>
              {([['cv', t('DOC_CV'), saved.cv_available, saved.cv_review_confirmed], ['cover_letter', t('DOC_COVER_LETTER'), saved.cover_letter_available, saved.cover_letter_review_confirmed]] as const)
                .filter(([, , available]) => available)
                .map(([kind, label, , reviewed]) => (
                  <div class="doc-row" key={kind}>
                    <span>{label}</span>
                    {reviewed ? (
                      <button class="btn small" onClick={() => download(kind)} disabled={!!busy}>{busy === 'download' ? '…' : t('DOWNLOAD_PDF')}</button>
                    ) : (
                      <button class="btn small" onClick={() => openInApp(saved.application_id!)}>{t('REVIEW_TO_DOWNLOAD')}</button>
                    )}
                  </div>
                ))}
              {!(saved.cv_review_confirmed && (saved.cover_letter_review_confirmed || !saved.cover_letter_available)) && (
                <p class="fine">{t('DOCS_REVIEW_HINT')}</p>
              )}
              <div class="row between">
                <button class="link" onClick={() => refreshDocuments(saved.application_id!)}>{t('REFRESH')}</button>
                <button class="link" onClick={retailor} disabled={!!busy}>{t('RETAILOR')}</button>
              </div>
            </section>
          )}

          <section class="card cv">
            <label class="field">
              <span>{t('FILL_FROM')}</span>
              <select value={profile?.cv?.source_key ?? ''} onChange={(e) => selectCv((e.target as HTMLSelectElement).value)} disabled={!profile || busy === 'cv'}>
                {profile?.cv_sources.length ? null : <option value="">{t('NO_CV_YET')}</option>}
                {profile?.cv_sources.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}{s.kind === 'profile' && s.language ? ` (${s.language.toUpperCase()})` : ''}</option>
                ))}
              </select>
            </label>
            {profile && (
              <p class="fine">
                {profile.contact.full_name || profile.contact.email}
                {currentCv ? ` · ${t('CV_SUMMARY', { roles: profile.cv?.experience.length ?? 0, skills: profile.cv?.skills.length ?? 0 })}` : ''}
              </p>
            )}
          </section>

          {plan && (
            <section class={`card plan ${plan.usage_ratio >= 1 ? 'exhausted' : plan.usage_ratio >= 0.8 ? 'near' : ''}`}>
              <div class="row between">
                <strong class="plan-name">{t('PLAN_LABEL', { plan: plan.plan.charAt(0).toUpperCase() + plan.plan.slice(1) })}</strong>
                {(plan.plan === 'free' || plan.usage_ratio >= 0.8) && (
                  <button class="link" onClick={() => browser.tabs.create({ url: `${APP_BASE_URL}/home/plans` })}>{t('UPGRADE')}</button>
                )}
              </div>
              {plan.tokens_total ? (
                <>
                  <div class="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(plan.usage_ratio * 100)}>
                    <span style={{ width: `${Math.min(100, Math.round(plan.usage_ratio * 100))}%` }} />
                  </div>
                  <p class="fine">{t(plan.lifetime_limit ? 'AI_USAGE_LIFETIME' : 'AI_USAGE', { pct: Math.round(plan.usage_ratio * 100) })}</p>
                  {plan.usage_ratio >= 1 ? <p class="fine warn">{t('PLAN_EXHAUSTED')}</p> : plan.usage_ratio >= 0.8 ? <p class="fine warn">{t('PLAN_NEAR_LIMIT')}</p> : null}
                </>
              ) : (
                <p class="fine">{t('AI_UNLIMITED')}</p>
              )}
            </section>
          )}

          <footer class="foot">
            <button class="link" onClick={() => call({ type: 'profile:get', refresh: true }).then((p) => setProfile(p as ExtensionProfile))}>{t('REFRESH_PROFILE')}</button>
            {scan && !blocked && site && <button class="link" onClick={() => setSitePaused(true)}>{t('PAUSE_SITE')}</button>}
            <button class="link" onClick={disconnect}>{t('DISCONNECT')}</button>
          </footer>
        </main>
      )}
    </div>
  );
}
