import { describe, expect, it, vi } from 'vitest';
import { adapterFor, GENERIC_ADAPTER } from '@/lib/autofill/adapters';
import { extractJob } from '@/lib/extract/job';

const LONG = 'You will design and build backend services. Requirements: 5+ years of Python experience, PostgreSQL, APIs. '.repeat(4);

describe('extractJob', () => {
  it('reads schema.org JobPosting from JSON-LD, including @graph', () => {
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebPage' }, {
        '@type': 'JobPosting', title: 'Python Engineer', description: `<p>${LONG}</p>`,
        hiringOrganization: { '@type': 'Organization', name: 'Globex' },
        jobLocation: { '@type': 'Place', address: { addressLocality: 'Berlin', addressCountry: 'DE' } },
      }],
    })}</script>`;
    document.body.innerHTML = '';
    const job = extractJob(document, new URL('https://boards.greenhouse.io/globex/jobs/42?gh_src=x#top'), adapterFor(new URL('https://boards.greenhouse.io')));
    expect(job).toMatchObject({ title: 'Python Engineer', company: 'Globex', location: 'Berlin, DE', source: 'json-ld', platform: 'greenhouse' });
    expect(job!.url).toBe('https://boards.greenhouse.io/globex/jobs/42?gh_src=x');
    expect(job!.description).toContain('Requirements');
  });

  it('canonicalizes LinkedIn search URLs to the job view URL', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `<h1 class="job-details-jobs-unified-top-card__job-title">Data Engineer</h1><div class="jobs-description__content">${LONG}</div>`;
    const url = new URL('https://www.linkedin.com/jobs/search/?currentJobId=3999&keywords=python');
    const job = extractJob(document, url, adapterFor(url));
    expect(job).toMatchObject({ url: 'https://www.linkedin.com/jobs/view/3999/', title: 'Data Engineer', source: 'adapter' });
  });

  it('returns null for pages that are not job postings', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `<main>${'Recipe for cake. Mix flour and sugar. '.repeat(20)}</main>`;
    expect(extractJob(document, new URL('https://example.com/cake'), GENERIC_ADAPTER)).toBeNull();
  });
});

describe('master-detail boards (search list + selected card)', () => {
  const detailHtml = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org/', '@type': 'JobPosting', title: 'Back-End Engineer',
    description: `<p>${LONG}</p>`, hiringOrganization: { name: 'Aambience Services' },
    jobLocation: { address: { addressLocality: 'Tavros', addressCountry: 'GR' } },
  })}</script></head><body></body></html>`;

  function listPage() {
    document.head.innerHTML = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[]}</script>`;
    document.body.innerHTML = `<main>
      <div class="jobCard__container"><a href="/view/aaa/cpp-engineer">C++ Engineer</a><a href="/company/x/jobs">Intracom</a></div>
      <div class="jobCard__container jobCard__selected--1Frtw"><a href="/company/k/jobs-at-aambience">Aambience</a><a href="/view/deTX/back-end-engineer">Back-End Engineer</a></div>
    </main>`;
  }

  it('finds the selected card link, skipping company links', async () => {
    listPage();
    const { findSelectedJobLink } = await import('@/lib/extract/job');
    expect(findSelectedJobLink(document, new URL('https://www.igwork.gr/search/athens/software-engineer-jobs?selectedJobId=1')))
      .toBe('https://www.igwork.gr/view/deTX/back-end-engineer');
  });

  it('fetches the detail page and reads its JobPosting', async () => {
    listPage();
    const { extractJobDeep } = await import('@/lib/extract/job');
    const fetchMock = vi.fn(async () => new Response(detailHtml, { headers: { 'content-type': 'text/html' } }));
    const job = await extractJobDeep(document, new URL('https://www.igwork.gr/search/athens/software-engineer-jobs?selectedJobId=1'), GENERIC_ADAPTER, fetchMock as any);
    expect(fetchMock).toHaveBeenCalledWith('https://www.igwork.gr/view/deTX/back-end-engineer', expect.objectContaining({ credentials: 'include' }));
    expect(job).toMatchObject({ title: 'Back-End Engineer', company: 'Aambience Services', location: 'Tavros, GR', source: 'json-ld', url: 'https://www.igwork.gr/view/deTX/back-end-engineer' });
  });

  it('never fetches cross-origin links and returns null when nothing is readable', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<main><div class="selected"><a href="https://tracker.example.com/job/1">x</a></div></main>';
    const { extractJobDeep } = await import('@/lib/extract/job');
    const fetchMock = vi.fn();
    expect(await extractJobDeep(document, new URL('https://board.example.org/search'), GENERIC_ADAPTER, fetchMock as any)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
