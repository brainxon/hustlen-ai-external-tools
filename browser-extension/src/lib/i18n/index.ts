import { useEffect, useState } from 'preact/hooks';
import { settingsStore } from '../storage';
import de from './de';
import en, { type Messages } from './en';
import es from './es';

/**
 * Extension UI translations - en / de / es, same three languages as the
 * web app. `auto` (default) follows the browser language; the user can
 * pick one in "My answers" > Settings.
 */
export type UiLanguage = 'en' | 'de' | 'es';
export type UiLanguagePref = UiLanguage | 'auto';
export type MessageKey = keyof Messages;

const DICTS: Record<UiLanguage, Messages> = { en, de, es };
export const UI_LANGUAGES: UiLanguage[] = ['en', 'de', 'es'];

export function resolveLanguage(pref: UiLanguagePref | undefined, browserLang: string = globalThis.navigator?.language || 'en'): UiLanguage {
  if (pref && pref !== 'auto') return pref;
  const base = browserLang.slice(0, 2).toLowerCase();
  return (UI_LANGUAGES as string[]).includes(base) ? (base as UiLanguage) : 'en';
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function translator(lang: UiLanguage): Translate {
  const dict = DICTS[lang];
  return (key, params) => {
    let s = dict[key] ?? en[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

export async function currentTranslator(): Promise<Translate> {
  const settings = await settingsStore.getValue().catch(() => null);
  return translator(resolveLanguage(settings?.uiLanguage));
}

/** Preact hook: translator that follows the saved language setting live. */
export function useT(): { t: Translate; lang: UiLanguage } {
  const [lang, setLang] = useState<UiLanguage>(() => resolveLanguage('auto'));
  useEffect(() => {
    settingsStore.getValue().then((s) => setLang(resolveLanguage(s.uiLanguage)));
    return settingsStore.watch((s) => setLang(resolveLanguage(s?.uiLanguage)));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return { t: translator(lang), lang };
}
