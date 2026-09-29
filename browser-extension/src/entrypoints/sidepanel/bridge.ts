import { browser } from 'wxt/browser';
import { HustlenApi } from '@/lib/api';
import type { BackgroundRequest, BackgroundResponse } from '@/lib/messages';

export async function call<T>(msg: BackgroundRequest): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as BackgroundResponse<T>;
  if (!res?.ok) {
    const err = new Error(res?.error || 'Something went wrong') as Error & { code?: string; status?: number };
    err.code = res?.code;
    err.status = res?.status;
    throw err;
  }
  return res.data;
}

/** The panel streams the tailoring pipeline itself; the background only lends it a token. */
export const panelApi = new HustlenApi((force) => call<string | null>({ type: 'auth:token', force }));

export async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}
