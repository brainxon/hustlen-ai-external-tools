import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionAlive, safely } from '@/lib/context';

const g = globalThis as any;
const original = { chrome: g.chrome, browser: g.browser };

afterEach(() => {
  g.chrome = original.chrome;
  g.browser = original.browser;
});

describe('orphaned content-script guard', () => {
  it('detects a live vs. disconnected extension context', () => {
    g.chrome = { runtime: { id: 'abc' } };
    expect(extensionAlive()).toBe(true);
    g.chrome = { runtime: undefined }; // what Chrome leaves after an extension reload
    g.browser = undefined;
    expect(extensionAlive()).toBe(false);
  });

  it('returns the fallback and tears down instead of throwing when the context is gone', async () => {
    g.chrome = { runtime: undefined };
    g.browser = undefined;
    const onDead = vi.fn();
    const call = vi.fn(async () => {
      throw new Error("'wxt/storage' must be loaded in a web extension environment");
    });
    await expect(safely(call, 'fallback', onDead)).resolves.toBe('fallback');
    expect(call).not.toHaveBeenCalled();
    expect(onDead).toHaveBeenCalled();
  });

  it('still surfaces real errors while the extension is alive', async () => {
    g.chrome = { runtime: { id: 'abc' } };
    await expect(safely(async () => { throw new Error('boom'); }, null)).rejects.toThrow('boom');
  });
});
