import { describe, expect, it } from 'vitest';
import { EXCLUDE_MATCHES, looksLikeJobContext, siteBlockReason, siteKey } from '@/lib/sites';

describe('siteBlockReason', () => {
  it.each([
    ['http://localhost:4300/home', 'local'],
    ['http://127.0.0.1:5004/docs', 'local'],
    ['http://192.168.178.89:4300/', 'local'],
    ['https://myapp.local/x', 'local'],
    ['https://hustlen.ai/', 'own'],
    ['https://app.hustlen.ai/home/root-cv', 'own'],
    ['https://devapp.hustlen.ai/extension/connect', 'own'],
    ['https://www.google.com/search?q=python+jobs', 'non-job'],
    ['https://mail.google.com/mail/u/0', 'non-job'],
    ['https://www.youtube.com/watch?v=1', 'non-job'],
    ['https://www.amazon.de/dp/123', 'non-job'],
    ['https://github.com/brainxon/chamba-ai', 'non-job'],
    ['https://www.linkedin.com/feed/', null], // LinkedIn is a job board; the job-context check handles its feed
    ['https://careers.google.com/jobs/results/123', null],
    ['https://www.apple.com/careers/de/', null],
    ['https://jobs.apple.com/en-us/details/200', null],
    ['https://boards.greenhouse.io/globex/jobs/42', null],
    ['https://www.igwork.gr/search/athens/software-engineer-jobs', null],
    ['https://acme-corp.com/about', null],
    ['chrome://extensions', 'local'],
  ])('%s -> %s', (url, reason) => {
    expect(siteBlockReason(url)).toBe(reason);
  });

  it('respects sites the user paused (and their subdomains)', () => {
    expect(siteBlockReason('https://jobs.acme-corp.com/1', ['acme-corp.com'])).toBe('paused');
    expect(siteBlockReason('https://other.com/', ['acme-corp.com'])).toBeNull();
  });

  it('never registers the all-sites script on own or local hosts', () => {
    expect(EXCLUDE_MATCHES).toEqual(expect.arrayContaining(['*://localhost/*', '*://127.0.0.1/*', '*://hustlen.ai/*', '*://*.hustlen.ai/*']));
  });

  it('pauses by registrable domain', () => {
    expect(siteKey('https://www.jobs.acme-corp.com/x')).toBe('acme-corp.com');
    expect(siteKey('https://shop.example.co.uk/')).toBe('example.co.uk');
  });
});

describe('looksLikeJobContext', () => {
  it('is false for a checkout or sign-up form on a generic site', () => {
    document.title = 'Checkout – Acme Store';
    document.head.innerHTML = '';
    document.body.innerHTML = '<h1>Checkout</h1><form><input name="first_name"><input name="last_name"><input name="email"><input name="card"></form>';
    expect(looksLikeJobContext(document, 'https://acme-store.com/checkout')).toBe(false);
  });

  it('is true for an application form, a JobPosting page, a jobs URL or a known ATS', () => {
    document.title = 'Acme';
    document.head.innerHTML = '';
    document.body.innerHTML = '<form><label>First name<input></label><label>Upload your resume<input type="file"></label></form>';
    expect(looksLikeJobContext(document, 'https://acme.com/form')).toBe(true);

    document.body.innerHTML = '<form><input><input><input></form>';
    document.head.innerHTML = '<script type="application/ld+json">{"@type":"JobPosting","title":"x"}</script>';
    expect(looksLikeJobContext(document, 'https://acme.com/p/1')).toBe(true);

    document.head.innerHTML = '';
    expect(looksLikeJobContext(document, 'https://acme.com/careers/backend-engineer')).toBe(true);
    expect(looksLikeJobContext(document, 'https://jobs.lever.co/acme/123')).toBe(true);
  });
});
