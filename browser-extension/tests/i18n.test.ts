import { describe, expect, it } from 'vitest';
import de from '@/lib/i18n/de';
import en from '@/lib/i18n/en';
import es from '@/lib/i18n/es';
import { resolveLanguage, translator } from '@/lib/i18n';

describe('i18n', () => {
  it('has every key translated in de and es (no English leftovers in placeholders)', () => {
    const keys = Object.keys(en);
    expect(Object.keys(de).sort()).toEqual([...keys].sort());
    expect(Object.keys(es).sort()).toEqual([...keys].sort());
    for (const k of keys as (keyof typeof en)[]) {
      const params = (en[k].match(/\{\w+\}/g) || []).sort();
      expect((de[k].match(/\{\w+\}/g) || []).sort()).toEqual(params);
      expect((es[k].match(/\{\w+\}/g) || []).sort()).toEqual(params);
    }
  });

  it('follows the browser language unless the user picked one', () => {
    expect(resolveLanguage('auto', 'de-AT')).toBe('de');
    expect(resolveLanguage('auto', 'es-MX')).toBe('es');
    expect(resolveLanguage('auto', 'fr-FR')).toBe('en');
    expect(resolveLanguage('es', 'de-DE')).toBe('es');
  });

  it('interpolates parameters', () => {
    expect(translator('es')('PAGE_FILLED', { count: 12 })).toBe('12 campos completados');
    expect(translator('de')('CV_SUMMARY', { roles: 3, skills: 14 })).toBe('3 Positionen · 14 Skills');
  });
});
