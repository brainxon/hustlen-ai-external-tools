import { describe, expect, it } from 'vitest';
import { readSse } from '@/lib/api';
import { buildAuthorizeUrl } from '@/lib/auth';
import { codeChallengeS256 } from '@/lib/pkce';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    expect(await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('buildAuthorizeUrl', () => {
  it('targets the SPA consent page with the extension client and scope', () => {
    const url = new URL(buildAuthorizeUrl({ challenge: 'c', state: 's', redirect: 'https://abc.chromiumapp.org/' }));
    expect(url.pathname).toBe('/extension/connect');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'hustlen-extension', scope: 'extension', code_challenge: 'c', code_challenge_method: 'S256', state: 's', redirect_uri: 'https://abc.chromiumapp.org/',
    });
  });
});

describe('readSse', () => {
  it('parses data events split across chunks', async () => {
    const chunks = ['data: {"type":"started"}\n\nda', 'ta: {"type":"progress","label":"Generating CV"}\n\n', 'data: {"type":"complete"}\n\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((s) => c.enqueue(new TextEncoder().encode(s)));
        c.close();
      },
    });
    const events: any[] = [];
    await readSse(stream, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['started', 'progress', 'complete']);
  });
});
