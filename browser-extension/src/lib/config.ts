/** Build-time configuration (see .env.example). */
export const API_BASE_URL: string = (import.meta.env.WXT_API_BASE_URL as string) || 'http://localhost:5004/api';
export const APP_BASE_URL: string = (import.meta.env.WXT_APP_BASE_URL as string) || 'http://localhost:4300';
export const OAUTH_CLIENT_ID: string = (import.meta.env.WXT_OAUTH_CLIENT_ID as string) || 'hustlen-extension';
export const OAUTH_SCOPE = 'extension';

/** Refresh the access token this many seconds before it expires. */
export const TOKEN_REFRESH_SKEW_S = 60;
/** Re-fetch the cached autofill profile after this long. */
export const PROFILE_TTL_MS = 30 * 60 * 1000;
