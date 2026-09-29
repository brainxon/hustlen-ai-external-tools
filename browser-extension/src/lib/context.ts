/**
 * After the extension is reloaded or updated, Chrome keeps the old content
 * scripts running in already-open tabs, but disconnected: `browser.runtime`
 * becomes undefined and any storage/messaging call throws ("'wxt/storage'
 * must be loaded in a web extension environment"). Content-script code
 * checks this before touching extension APIs and tears itself down instead.
 */
export function extensionAlive(): boolean {
  try {
    const g = globalThis as unknown as { chrome?: { runtime?: { id?: string } }; browser?: { runtime?: { id?: string } } };
    return Boolean(g.chrome?.runtime?.id ?? g.browser?.runtime?.id);
  } catch {
    return false;
  }
}

/** Runs an extension-API call; returns `fallback` (instead of throwing) if the context is gone. */
export async function safely<T>(fn: () => Promise<T>, fallback: T, onDead?: () => void): Promise<T> {
  if (!extensionAlive()) {
    onDead?.();
    return fallback;
  }
  try {
    return await fn();
  } catch (e) {
    if (!extensionAlive()) {
      onDead?.();
      return fallback;
    }
    throw e;
  }
}
