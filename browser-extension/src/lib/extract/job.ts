import type { ExtractedJob } from '../types';
import type { PlatformAdapter } from '../autofill/adapters';

/**
 * Pulls the job posting out of the page the user is already on - no
 * backend re-fetch needed, so it also works behind logins (LinkedIn) and on
 * JS-rendered boards. Order: schema.org JobPosting JSON-LD (what Google
 * Jobs indexes, present on most ATS pages) -> ATS adapter selectors ->
 * main-content text.
 */

const MAX_DESCRIPTION = 20000;
const MIN_DESCRIPTION = 200;

export function htmlToText(html: string, doc: Document = document): string {
  const div = doc.createElement('div');
  div.innerHTML = html.replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '$&\n');
  return (div.textContent || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function findJobPosting(node: any): any | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n);
      if (hit) return hit;
    }
    return null;
  }
  const type = asArray(node['@type']).map(String);
  if (type.includes('JobPosting')) return node;
  return findJobPosting(node['@graph']) ?? findJobPosting(node.mainEntity);
}

function locationOf(posting: any): string {
  const places = asArray(posting.jobLocation);
  const parts = places
    .map((p: any) => {
      const a = p?.address ?? p;
      if (typeof a === 'string') return a;
      return [a?.addressLocality, a?.addressRegion, typeof a?.addressCountry === 'string' ? a.addressCountry : a?.addressCountry?.name]
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean);
  if (posting.jobLocationType === 'TELECOMMUTE') parts.push('Remote');
  return Array.from(new Set(parts)).join(' | ');
}

export function extractFromJsonLd(doc: Document): Omit<ExtractedJob, 'url' | 'platform'> | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: any;
    try {
      data = JSON.parse(script.textContent || '');
    } catch {
      continue;
    }
    const posting = findJobPosting(data);
    if (!posting) continue;
    const org = asArray(posting.hiringOrganization)[0];
    return {
      title: String(posting.title || '').trim(),
      company: String((typeof org === 'string' ? org : org?.name) || '').trim(),
      location: locationOf(posting),
      description: htmlToText(String(posting.description || ''), doc).slice(0, MAX_DESCRIPTION),
      source: 'json-ld',
    };
  }
  return null;
}

function pick(doc: Document, selector?: string): string {
  if (!selector) return '';
  const el = doc.querySelector<HTMLElement>(selector);
  return (el?.innerText || el?.textContent || '').replace(/\s+\n/g, '\n').trim();
}

export function canonicalJobUrl(loc: URL, adapter: PlatformAdapter, doc: Document): string {
  const fromAdapter = adapter.canonicalUrl?.(loc);
  if (fromAdapter) return fromAdapter;
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) {
    try {
      const c = new URL(canonical);
      if (c.hostname === loc.hostname && c.pathname.length > 1) return c.toString();
    } catch {
      /* fall through */
    }
  }
  const u = new URL(loc.toString());
  u.hash = '';
  return u.toString();
}

export function extractJob(doc: Document, loc: URL, adapter: PlatformAdapter): ExtractedJob | null {
  const url = canonicalJobUrl(loc, adapter, doc);
  const ld = extractFromJsonLd(doc);
  const fromDom = {
    title: pick(doc, adapter.job?.title),
    company: pick(doc, adapter.job?.company),
    location: pick(doc, adapter.job?.location),
    description: pick(doc, adapter.job?.description).slice(0, MAX_DESCRIPTION),
  };

  if (ld && ld.description.length >= MIN_DESCRIPTION) {
    return {
      ...ld,
      title: ld.title || fromDom.title,
      company: ld.company || fromDom.company,
      location: ld.location || fromDom.location,
      url,
      platform: adapter.id,
    };
  }
  if (fromDom.description.length >= MIN_DESCRIPTION) {
    return { ...fromDom, title: fromDom.title || ld?.title || '', company: fromDom.company || ld?.company || '', url, source: 'adapter', platform: adapter.id };
  }

  // Generic fallback: the main content, only if it reads like a posting.
  const main = doc.querySelector<HTMLElement>('main, [role="main"], article') ?? doc.body;
  const text = (main?.innerText || main?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  const looksLikeJob = /\b(responsibilit|requirement|qualification|experience|aufgaben|anforderungen|profil|requisitos|responsabilidades|we offer|what you('| wi)ll do)\b/i.test(text);
  if (text.length >= MIN_DESCRIPTION && looksLikeJob) {
    const h1 = doc.querySelector('h1')?.textContent?.trim() || doc.title;
    return { title: ld?.title || h1 || '', company: ld?.company || '', location: ld?.location || '', description: text.slice(0, MAX_DESCRIPTION), url, source: 'page-text', platform: adapter.id };
  }
  return null;
}
