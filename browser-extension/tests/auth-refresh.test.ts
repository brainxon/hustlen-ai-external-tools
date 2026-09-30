import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { AuthError, getAccessToken, isConnected } from '@/lib/auth';
import { refreshTokenStore, tokenStore } from '@/lib/storage';

/**
 * #5: a transient failure of the refresh request (network down, 5xx, the
 * backend restarting during a deploy) must not disconnect the extension -
 * only a definitive OAuth rejection may.
 */
describe('token refresh', () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    await refreshTokenStore.setValue('rt-1');
    await tokenStore.setValue({ accessToken: 'old', expiresAt: Date.now() - 1000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));

  it('keeps the session when the backend answers 503', async () => {
    respond(503, { detail: 'Service Unavailable' });
    await expect(getAccessToken()).rejects.toMatchObject({ code: 'unreachable' });
    expect(await refreshTokenStore.getValue()).toBe('rt-1');
    expect(await isConnected()).toBe(true);
  });

  it('keeps the session when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await getAccessToken().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('unreachable');
    expect(await isConnected()).toBe(true);
  });

  it('disconnects when the refresh token is rejected (invalid_grant)', async () => {
    respond(400, { error: 'invalid_grant', error_description: 'Refresh token is invalid, expired, revoked' });
    expect(await getAccessToken()).toBeNull();
    expect(await refreshTokenStore.getValue()).toBeNull();
    expect(await isConnected()).toBe(false);
  });

  it('stores the rotated tokens on success', async () => {
    respond(200, { access_token: 'new', refresh_token: 'rt-2', expires_in: 1800 });
    expect(await getAccessToken()).toBe('new');
    expect(await refreshTokenStore.getValue()).toBe('rt-2');
  });
});
