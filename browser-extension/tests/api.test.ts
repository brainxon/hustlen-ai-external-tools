import { describe, expect, it, vi } from 'vitest';
import { ApiError, HustlenApi } from '@/lib/api';

const job = { url: 'https://jobs.example.com/1', title: 'Python Engineer', company: 'Globex', location: 'Berlin', description: 'x'.repeat(300), source: 'json-ld' as const, platform: 'generic' };

function apiWith(fetchImpl: any) {
  vi.stubGlobal('fetch', fetchImpl);
  return new HustlenApi(async () => 'token', 'https://api.test/api');
}

describe('HustlenApi', () => {
  it('saves the job structurally on the extension endpoint (no AI route)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ found: true, application_id: 9, existing: false }), { status: 200 }));
    const res = await apiWith(fetchMock).saveJob(job);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.test/api/extension/applications');
    expect(JSON.parse(init.body)).toEqual({ url: job.url, title: 'Python Engineer', company: 'Globex', location: 'Berlin', description: job.description, source: 'json-ld' });
    expect(fetchMock.mock.calls.some(([u]: any) => String(u).includes('from-job-description'))).toBe(false);
    expect(res.application_id).toBe(9);
  });

  it('keeps the error code of plan-limit responses so the UI can offer an upgrade', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: { error_code: 'token_credits_exceeded', message: 'AI token credits exceeded' } }), { status: 402 }));
    const err = await apiWith(fetchMock).prepareForTailoring(9).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(402);
    expect(err.code).toBe('token_credits_exceeded');
  });

  it('reads the plan summary', async () => {
    const plan = { plan: 'free', tokens_used: 1, tokens_total: 4, tokens_remaining: 3, lifetime_limit: true, period_end: null, usage_ratio: 0.25 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 }));
    expect(await apiWith(fetchMock).plan()).toEqual(plan);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe('https://api.test/api/extension/plan');
  });
});
