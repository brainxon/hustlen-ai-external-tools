import { describe, expect, it } from 'vitest';
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
