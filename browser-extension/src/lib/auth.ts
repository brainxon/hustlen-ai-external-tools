import { browser } from 'wxt/browser';
import { API_BASE_URL, APP_BASE_URL, OAUTH_CLIENT_ID, OAUTH_SCOPE, TOKEN_REFRESH_SKEW_S } from './config';
import { createPkcePair, randomString } from './pkce';
import { clearSession, refreshTokenStore, tokenStore } from './storage';

/**
 * "Connect with hustlen.ai" - OAuth 2.1 authorization code + PKCE
 * (backend REQ-EXT-001). launchWebAuthFlow opens app.hustlen.ai's
 * /extension/connect consent page in a browser-managed window; a user who
 * is already signed in to the web app just clicks "Connect". Runs only in
 * the background script.
 */

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class AuthError extends Error {}

export function redirectUri(): string {
  return browser.identity.getRedirectURL();
}

export function buildAuthorizeUrl(params: { challenge: string; state: string; redirect: string }): string {
  const url = new URL('/extension/connect', APP_BASE_URL);
  url.search = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: params.redirect,
    scope: OAUTH_SCOPE,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    state: params.state,
  }).toString();
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, ...body }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new AuthError(detail.error_description || detail.error || `Token request failed (${res.status})`);
  }
  return res.json();
}

async function saveTokens(t: TokenResponse): Promise<string> {
  await tokenStore.setValue({ accessToken: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  await refreshTokenStore.setValue(t.refresh_token);
  return t.access_token;
}

export async function connect(): Promise<void> {
  const { verifier, challenge } = await createPkcePair();
  const state = randomString(16);
  const redirect = redirectUri();

  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: buildAuthorizeUrl({ challenge, state, redirect }),
    interactive: true,
  });
  if (!responseUrl) throw new AuthError('Sign-in was cancelled');

  const params = new URL(responseUrl).searchParams;
  if (params.get('state') !== state) throw new AuthError('State mismatch - please try again');
  if (params.get('error')) throw new AuthError(params.get('error') === 'access_denied' ? 'Connection was cancelled' : params.get('error')!);
  const code = params.get('code');
  if (!code) throw new AuthError('No authorization code returned');

  await saveTokens(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }));
}

let refreshing: Promise<string | null> | null = null;

/** Refresh-token rotation; concurrent callers share one request. */
async function refresh(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await refreshTokenStore.getValue();
      if (!refreshToken) return null;
      try {
        return await saveTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
      } catch {
        await clearSession();
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** A valid access token, refreshing if needed; null when not connected. */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const tokens = await tokenStore.getValue();
  if (!forceRefresh && tokens && tokens.expiresAt - TOKEN_REFRESH_SKEW_S * 1000 > Date.now()) {
    return tokens.accessToken;
  }
  return refresh();
}

export async function isConnected(): Promise<boolean> {
  return (await refreshTokenStore.getValue()) !== null;
}

export async function disconnect(): Promise<void> {
  await clearSession();
}
