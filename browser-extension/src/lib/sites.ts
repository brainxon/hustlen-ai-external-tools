import { API_BASE_URL, APP_BASE_URL } from './config';
import { ADAPTERS } from './autofill/adapters';

/**
 * Where the extension stays out of the way:
 *  - our own properties and local development hosts - always;
 *  - well-known sites that are obviously not job boards (search, social,
 *    shopping, dev tools, productivity, banking...) - unless the URL itself
 *    is a careers/jobs page (careers.google.com, apple.com/careers);
 *  - sites the user paused from the side panel.
 * Everywhere else the in-page button additionally needs job context on the
 * page (see looksLikeJobContext), so checkout/sign-up/contact forms don't
 * get an "Autofill" button.
 */

export type SiteBlockReason = 'own' | 'local' | 'non-job' | 'paused';

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const OWN_DOMAINS = Array.from(new Set(['hustlen.ai', hostOf(APP_BASE_URL), hostOf(API_BASE_URL)].filter(Boolean)));

const NON_JOB_DOMAINS = [
  // search / portals
  'google.com', 'google.de', 'google.es', 'google.gr', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'baidu.com', 'yandex.ru',
  // social / media / messaging
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'reddit.com', 'pinterest.com', 'snapchat.com',
  'youtube.com', 'twitch.tv', 'netflix.com', 'spotify.com', 'vimeo.com', 'medium.com', 'substack.com', 'tumblr.com',
  'whatsapp.com', 'telegram.org', 'discord.com', 'messenger.com', 'signal.org',
  // shopping / travel / payments / banking
  'amazon.com', 'amazon.de', 'amazon.es', 'amazon.co.uk', 'ebay.com', 'ebay.de', 'aliexpress.com', 'etsy.com', 'zalando.de',
  'booking.com', 'airbnb.com', 'expedia.com', 'paypal.com', 'stripe.com', 'revolut.com', 'wise.com', 'n26.com',
  // productivity / dev / AI
  'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'npmjs.com', 'vercel.com', 'netlify.com',
  'notion.so', 'slack.com', 'figma.com', 'canva.com', 'miro.com', 'trello.com', 'atlassian.net', 'asana.com', 'dropbox.com',
  'zoom.us', 'office.com', 'live.com', 'outlook.com', 'microsoftonline.com', 'icloud.com', 'apple.com', 'microsoft.com',
  'chatgpt.com', 'openai.com', 'claude.ai', 'anthropic.com', 'gemini.google.com', 'perplexity.ai', 'deepl.com',
  // reference / news
  'wikipedia.org', 'wikimedia.org', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'cnn.com', 'theguardian.com', 'spiegel.de', 'elpais.com',
];

// A careers/jobs page on an otherwise non-job domain is fine.
const JOB_HOST_PREFIX = /^(careers?|jobs?|karriere|stellen|empleo|empleos|trabajo|vacantes|recruiting|talent|apply|join)\./i;
const JOB_PATH = /\/(careers?|jobs?|job-openings?|openings|vacanc(y|ies)|karriere|stellen(angebote)?|empleos?|trabajos?|vacantes|carrieres?|carreiras?|lavora-con-noi|lavoro|recruit(ing|ment)?|apply)(\/|$|\?|-)/i;

const matchesDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test') ||
    host === '0.0.0.0' || host === '[::1]' || host === '::1' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export function siteBlockReason(url: string, pausedSites: string[] = []): SiteBlockReason | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'local';
  }
  if (!/^https?:$/.test(u.protocol)) return 'local';
  const host = u.hostname.toLowerCase();
  if (isLocalHost(host)) return 'local';
  if (OWN_DOMAINS.some((d) => matchesDomain(host, d))) return 'own';
  if (pausedSites.some((d) => matchesDomain(host, d))) return 'paused';
  if (NON_JOB_DOMAINS.some((d) => matchesDomain(host, d)) && !JOB_HOST_PREFIX.test(host) && !JOB_PATH.test(u.pathname)) {
    return 'non-job';
  }
  return null;
}

/** Match patterns the all-sites content script must never run on (scripting.registerContentScripts excludeMatches). */
export const EXCLUDE_MATCHES = [
  '*://localhost/*', '*://127.0.0.1/*', '*://*.local/*', '*://*.localhost/*',
  ...OWN_DOMAINS.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]),
];

/** Site name to pause/resume from the panel: the registrable-ish domain (last two labels). */
export function siteKey(url: string): string {
  const host = hostOf(url).replace(/^www\./, '');
  const parts = host.split('.');
  const twoLevelTld = /^(co|com|org|gov|ac)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoLevelTld ? -3 : -2).join('.');
}

const JOB_WORDS = /\b(job|jobs|career|careers|vacanc|position|opening|apply|application|resume|résumé|cv\b|curriculum|recruit|hiring|stelle|stellen|bewerb|karriere|lebenslauf|empleo|trabajo|vacante|postul|oferta|candidat|puesto|emploi|poste|candidature|vaga|candidatura|emprego|lavoro|posizione|annuncio)/i;
const FORM_SIGNALS = /\b(resume|résumé|cv\b|curriculum|lebenslauf|cover ?letter|anschreiben|carta de presentaci|lettre de motivation|linkedin|work experience|berufserfahrung|experiencia|years of experience|salary|gehalt|salario|notice period|kündigungsfrist|authori[sz]ed to work|sponsorship)/i;

/**
 * Does the page look like a job application context? Known ATS, a
 * schema.org JobPosting, a jobs-like URL, job words in the title/heading,
 * or form labels only an application form has (CV upload, cover letter,
 * experience, work authorization...).
 */
export function looksLikeJobContext(doc: Document, url: string): boolean {
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    /* ignore */
  }
  if (u && ADAPTERS.some((a) => a.matches(u!))) return true;
  if (u && (JOB_HOST_PREFIX.test(u.hostname) || JOB_PATH.test(u.pathname) || JOB_WORDS.test(u.pathname + u.search))) return true;
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    if (/"JobPosting"/.test(s.textContent || '')) return true;
  }
  const heading = `${doc.title} ${doc.querySelector('h1')?.textContent || ''}`;
  if (JOB_WORDS.test(heading)) return true;
  const formText = Array.from(doc.querySelectorAll('form, [role="dialog"], dialog'))
    .map((f) => f.textContent || '')
    .join(' ')
    .slice(0, 20000);
  if (FORM_SIGNALS.test(formText)) return true;
  return Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]')).some((i) =>
    FORM_SIGNALS.test(`${i.name} ${i.id} ${i.accept} ${i.getAttribute('aria-label') || ''} ${i.closest('label, div')?.textContent || ''}`),
  );
}
