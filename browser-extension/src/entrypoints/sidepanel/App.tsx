import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { APP_BASE_URL } from '@/lib/config';
import type { AutofillReport, PageScan } from '@/lib/messages';
import { storage } from 'wxt/utils/storage';
import type { ApplicationLookup, DocumentKind, DocumentStatus, ExtensionProfile } from '@/lib/types';
import logoSvg from '@/assets/logo.svg?raw';
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
  const tabId = useRef<number | null>(null);
  const tailorAbort = useRef<AbortController | null>(null);

  const run = useCallback(async <T,>(kind: Busy, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e: any) {
      if (e?.status === 401 || e?.code === 'not_connected') setConnected(false);
      setError(e?.message || 'Something went wrong');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshPage = useCallback(async () => {
    const t = await activeTab();
    tabId.current = t?.id ?? null;
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
      setLookup(s?.job ? await call<ApplicationLookup>({ type: 'app:lookup', url: s.job.url }).catch(() => null) : null);
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
      if (tabId.current == null) throw new Error('Open a job application first');
      const r = await call<AutofillReport | { error: string }>({ type: 'tab:autofill', tabId: tabId.current });
      if (!r) throw new Error('No application form found on this page');
      if ('error' in r) throw new Error(r.error);
      setReport(r);
      if (r.coverLetter === 'missing') setNotice('This form has a cover letter field. Tailor this job to fill it automatically.');
    });

  const save = async (): Promise<number | null> => {
    if (lookup?.found && lookup.application_id) return lookup.application_id;
    if (!scan?.job) {
      setError('Could not read a job posting on this page');
      return null;
    }
    const res = await run('save', () => call<{ application_id: number; existing: boolean }>({ type: 'app:save', job: scan.job! }));
    if (!res) return null;
    setLookup({ found: true, application_id: res.application_id, status: 'Pending', job_title: scan.job.title, company_name: scan.job.company });
    setNotice(res.existing ? 'Already in your applications' : 'Saved to your applications');
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
      setError('Tailoring is already running for this job');
      return;
    }
    const docs: DocumentStatus | null = lookup?.cv_available ? (lookup as DocumentStatus) : await panelApi.documentStatus(appId).catch(() => null);
    if (docs?.cv_available && !force) {
      setLookup((l) => (l ? { ...l, ...docs } : l));
      setNotice('This job already has a tailored CV');
      return;
    }
    const source = profile.cv_sources.find((s) => s.key === (profile.cv?.source_key ?? '')) ?? profile.cv_sources.find((s) => s.is_default);
    if (!source) {
      setError('Create a Master CV in hustlen.ai first');
      return;
    }
    tailorAbort.current = new AbortController();
    setSteps([]);
    setTailorDone(null);
    await markInFlight(appId, true);
    await run('tailor', () =>
      panelApi.streamTailor(
        appId,
        source.kind === 'root' ? { root_cv_language: source.root_cv_language } : { user_cv_id: source.user_cv_id },
        (ev) => {
          if (ev.type === 'progress') setSteps((prev) => [...prev.map((s) => ({ ...s, done: true })), { label: ev.label || ev.node, done: false }]);
          if (ev.type === 'complete') {
            setSteps((prev) => prev.map((s) => ({ ...s, done: true })));
            setTailorDone(appId);
          }
          if (ev.type === 'error') throw new Error(ev.message || 'Tailoring failed');
        },
        tailorAbort.current?.signal,
      ),
    );
    await markInFlight(appId, false);
    await refreshDocuments(appId);
  };

  const retailor = () => {
    if (window.confirm('Create a new tailored version of your CV and cover letter for this job? The current version stays in hustlen.ai.')) {
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
      setNotice('Marked as submitted');
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

  const openInApp = (appId: number) => browser.tabs.create({ url: `${APP_BASE_URL}/home/quick-application?applicationId=${appId}` });

  if (connected === null) return <div class="shell center"><div class="spinner" aria-label="Loading" /></div>;

  if (!connected) {
    return (
      <div class="shell onboarding">
        <header class="brand"><Logo /><span>hustlen.ai</span></header>
        <h1>Applying to jobs<br /><em>just got easier</em></h1>
        <p class="lead">Autofill and track job applications with your hustlen.ai Master CV, right from the posting.</p>
        <ul class="features">
          <li><span class="dot">⚡</span>Fill application forms in one click, on Workday, Greenhouse, Lever, LinkedIn and more</li>
          <li><span class="dot">✦</span>Draft answers to screening questions from your CV, for you to review</li>
          <li><span class="dot">◎</span>Every job you apply to is saved and tracked automatically</li>
        </ul>
        <button class="btn primary block" onClick={connect} disabled={busy === 'connect'}>
          {busy === 'connect' ? 'Connecting…' : 'Connect with hustlen.ai'}
        </button>
        <p class="fine">Already signed in on hustlen.ai? It takes one click. No password is stored in the extension.</p>
        {error && <p class="alert" role="alert">{error}</p>}
      </div>
    );
  }

  const job = scan?.job;
  const saved = lookup?.found ? lookup : null;
  const currentCv = profile?.cv_sources.find((s) => s.key === profile.cv?.source_key);

  return (
    <div class="shell">
      <header class="topbar">
        <div class="brand"><Logo /><span>hustlen.ai</span></div>
        <nav class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'apply'} class={tab === 'apply' ? 'active' : ''} onClick={() => setTab('apply')}>Apply</button>
          <button role="tab" aria-selected={tab === 'answers'} class={tab === 'answers' ? 'active' : ''} onClick={() => setTab('answers')}>My answers</button>
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
                  {saved ? <span class={`status s-${(saved.status || 'pending').toLowerCase()}`}>{saved.status}</span> : <span class="status muted">Not saved</span>}
                </div>
                <h2 class="job-title">{job.title || 'Untitled position'}</h2>
                <p class="job-meta">{[job.company, job.location].filter(Boolean).join(' · ') || 'Company not detected'}</p>
              </>
            ) : needsAccess ? (
              <>
                <h2 class="job-title">Allow hustlen.ai on this page</h2>
                <p class="job-meta">To detect jobs and autofill on any job site, not only the major ATS, the extension needs to read the page you are on.</p>
                <button class="btn primary block access" onClick={grantAllSites}>Work on every job site</button>
                <p class="fine">Or click the hustlen.ai toolbar icon to allow just this tab.</p>
              </>
            ) : (
              <>
                <h2 class="job-title">No job posting detected</h2>
                <p class="job-meta">{scan?.hasApplicationForm ? 'An application form is on this page. You can still autofill it.' : 'Open a job posting or application form.'}</p>
              </>
            )}
          </section>

          <section class="actions">
            <button class="btn primary big" onClick={autofill} disabled={!!busy || !scan}>
              <span>{busy === 'autofill' ? 'Filling…' : 'Autofill application'}</span>
              <kbd>⌥⇧F</kbd>
            </button>
            <div class="grid">
              <button class="btn" onClick={save} disabled={!!busy || !job || !!saved}>{busy === 'save' ? 'Saving…' : saved ? '✓ Saved' : 'Save job'}</button>
              {saved?.cv_available ? (
                <button class="btn done" onClick={() => saved.application_id && openInApp(saved.application_id)} disabled={!!busy} title="Open the tailored CV in hustlen.ai">✓ Tailored</button>
              ) : (
                <button class="btn" onClick={() => tailor()} disabled={!!busy || !job}>{busy === 'tailor' ? 'Tailoring…' : 'Tailor CV + letter'}</button>
              )}
              <button class="btn" onClick={markSubmitted} disabled={!!busy || !job || saved?.status === 'Submitted'}>{saved?.status === 'Submitted' ? '✓ Submitted' : 'Mark as applied'}</button>
              <button class="btn" onClick={() => saved?.application_id && openInApp(saved.application_id)} disabled={!saved?.application_id}>Open in hustlen.ai</button>
            </div>
          </section>

          {notice && <p class="notice" role="status">{notice}</p>}
          {error && <p class="alert" role="alert">{error}</p>}

          {report && (
            <section class="card report">
              <div class="stats">
                <div><strong>{report.filled + report.aiAnswered}</strong><span>filled</span></div>
                <div><strong>{report.needsReview.length}</strong><span>to review</span></div>
                <div><strong>{report.unanswered.length}</strong><span>left for you</span></div>
                <div><strong>{report.durationMs}ms</strong><span>local fill</span></div>
              </div>
              {report.needsReview.length > 0 && (
                <details>
                  <summary>Fields to review (outlined in amber)</summary>
                  <ul>{report.needsReview.map((l) => <li key={l}>{l}</li>)}</ul>
                </details>
              )}
              <p class="fine">Check every answer before you submit. The extension never submits for you.</p>
            </section>
          )}

          {steps.length > 0 && (
            <section class="card steps" aria-live="polite">
              <h3>Tailoring your CV and cover letter</h3>
              <ol>{steps.map((s, i) => <li key={i} class={s.done ? 'done' : 'active'}>{s.label}</li>)}</ol>
              {tailorDone && <p class="fine">Done. Review it in hustlen.ai to unlock the PDF download here.</p>}
            </section>
          )}

          {saved?.application_id && (saved.cv_available || saved.cover_letter_available) && (
            <section class="card docs">
              <h3>Your tailored documents</h3>
              {([['cv', 'CV', saved.cv_available, saved.cv_review_confirmed], ['cover_letter', 'Cover letter', saved.cover_letter_available, saved.cover_letter_review_confirmed]] as const)
                .filter(([, , available]) => available)
                .map(([kind, label, , reviewed]) => (
                  <div class="doc-row" key={kind}>
                    <span>{label}</span>
                    {reviewed ? (
                      <button class="btn small" onClick={() => download(kind)} disabled={!!busy}>{busy === 'download' ? '…' : 'Download PDF'}</button>
                    ) : (
                      <button class="btn small" onClick={() => openInApp(saved.application_id!)}>Review to download</button>
                    )}
                  </div>
                ))}
              {!(saved.cv_review_confirmed && (saved.cover_letter_review_confirmed || !saved.cover_letter_available)) && (
                <p class="fine">Downloads unlock after you review each document in hustlen.ai, so nothing AI-written goes out unchecked.</p>
              )}
              <div class="row between">
                <button class="link" onClick={() => refreshDocuments(saved.application_id!)}>Refresh</button>
                <button class="link" onClick={retailor} disabled={!!busy}>Re-tailor (new version)</button>
              </div>
            </section>
          )}

          <section class="card cv">
            <label class="field">
              <span>Fill from</span>
              <select value={profile?.cv?.source_key ?? ''} onChange={(e) => selectCv((e.target as HTMLSelectElement).value)} disabled={!profile || busy === 'cv'}>
                {profile?.cv_sources.length ? null : <option value="">No CV yet</option>}
                {profile?.cv_sources.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}{s.kind === 'profile' && s.language ? ` (${s.language.toUpperCase()})` : ''}</option>
                ))}
              </select>
            </label>
            {profile && (
              <p class="fine">
                {profile.contact.full_name || profile.contact.email}
                {currentCv ? ` · ${profile.cv?.experience.length ?? 0} roles · ${profile.cv?.skills.length ?? 0} skills` : ''}
              </p>
            )}
          </section>

          <footer class="foot">
            <button class="link" onClick={() => call({ type: 'profile:get', refresh: true }).then((p) => setProfile(p as ExtensionProfile))}>Refresh profile</button>
            <button class="link" onClick={disconnect}>Disconnect</button>
          </footer>
        </main>
      )}
    </div>
  );
}
