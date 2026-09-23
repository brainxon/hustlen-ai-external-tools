import type { FieldDescriptor } from './fields';
import { normalize } from './fields';

/**
 * Writes values into form controls so that the page's framework notices:
 * React/Vue/Angular inputs ignore a plain `el.value = x`, so we go through
 * the native prototype setter and dispatch the events a real user would.
 */

const COUNTRY_ALIASES: string[][] = [
  ['united states', 'united states of america', 'usa', 'us', 'estados unidos', 'vereinigte staaten'],
  ['united kingdom', 'uk', 'great britain', 'england', 'reino unido', 'vereinigtes königreich'],
  ['germany', 'deutschland', 'de', 'alemania', 'allemagne'],
  ['spain', 'españa', 'es', 'spanien', 'espagne'],
  ['mexico', 'méxico', 'mx', 'mexiko'],
  ['austria', 'österreich', 'at'],
  ['switzerland', 'schweiz', 'suiza', 'ch', 'suisse'],
  ['netherlands', 'niederlande', 'países bajos', 'holland', 'nl'],
  ['france', 'frankreich', 'francia', 'fr'],
  ['italy', 'italien', 'italia', 'it'],
  ['peru', 'perú', 'pe'],
  ['colombia', 'kolumbien', 'co'],
  ['argentina', 'argentinien', 'ar'],
  ['chile', 'cl'],
  ['bolivia', 'bolivien', 'bo'],
  ['ecuador', 'ec'],
  ['venezuela', 've'],
  ['brazil', 'brasil', 'brasilien', 'br'],
  ['canada', 'kanada', 'canadá', 'ca'],
];

const YES = /^(yes|ja|s[ií]|oui|sim|y|true)\b/i;
const NO = /^(no|nein|non|não|n|false)\b/i;
const NEGATION = /\b(not|don'?t|do not|won'?t|will not|no|nicht|kein|nein|non|sin)\b/i;

function fold(s: string): string {
  return normalize(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function aliasesOf(value: string): string[] {
  const v = fold(value);
  const group = COUNTRY_ALIASES.find((g) => g.map(fold).includes(v));
  return group ? group.map(fold) : [v];
}

function rangeContains(option: string, n: number): boolean {
  const o = fold(option);
  const plus = o.match(/(\d+)\s*\+|(?:more than|over|mehr als|más de)\s*(\d+)/);
  if (plus) return n >= Number(plus[1] ?? plus[2]);
  const less = o.match(/(?:less than|under|weniger als|menos de)\s*(\d+)/);
  if (less) return n < Number(less[1]);
  const range = o.match(/(\d+)\s*(?:-|–|to|bis|a)\s*(\d+)/);
  if (range) return n >= Number(range[1]) && n <= Number(range[2]);
  return false;
}

/**
 * Picks the option that best represents `value`. Returns its index, or -1.
 * `boolean` is set for yes/no style answers so options like
 * "I will not require sponsorship" can be matched too.
 */
export function matchOption(options: string[], value: string, boolean?: boolean): number {
  const opts = options.map(fold);
  if (boolean !== undefined) {
    const direct = opts.findIndex((o) => (boolean ? YES : NO).test(o));
    if (direct >= 0) return direct;
    const sentence = opts.findIndex((o) => o.length > 3 && (boolean ? !NEGATION.test(o) : NEGATION.test(o)));
    if (sentence >= 0 && opts.length <= 3) return sentence;
    return -1;
  }
  const wanted = aliasesOf(value);
  let i = opts.findIndex((o) => wanted.includes(o));
  if (i >= 0) return i;
  i = opts.findIndex((o) => wanted.some((w) => w.length > 2 && (o.startsWith(w) || w.startsWith(o) && o.length > 3)));
  if (i >= 0) return i;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  if (value && !Number.isNaN(n) && /\d/.test(value)) {
    i = opts.findIndex((o) => rangeContains(o, n));
    if (i >= 0) return i;
  }
  i = opts.findIndex((o) => wanted.some((w) => w.length > 3 && o.includes(w)));
  return i;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function fire(el: HTMLElement, ...types: string[]): void {
  for (const type of types) {
    el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }
}

function toIsoDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const eu = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (eu) return `${eu[3]}-${eu[2]!.padStart(2, '0')}-${eu[1]!.padStart(2, '0')}`;
  return null;
}

export function fillText(el: HTMLInputElement | HTMLTextAreaElement, value: string, maxLength?: number | null): boolean {
  let v = value;
  if ((el as HTMLInputElement).type === 'date') {
    const iso = toIsoDate(value);
    if (!iso) return false;
    v = iso;
  }
  if ((el as HTMLInputElement).type === 'number') {
    const n = value.match(/-?\d+(\.\d+)?/);
    if (!n) return false;
    v = n[0];
  }
  if (maxLength && v.length > maxLength) v = v.slice(0, maxLength);
  el.focus({ preventScroll: true });
  setNativeValue(el, v);
  fire(el, 'input', 'change');
  el.blur();
  return true;
}

export function fillSelect(el: HTMLSelectElement, value: string, boolean?: boolean): boolean {
  const options = Array.from(el.options).filter((o) => o.value !== '' && !o.disabled);
  const idx = matchOption(options.map((o) => o.textContent || o.value), value, boolean);
  if (idx < 0) return false;
  const option = options[idx]!;
  setNativeValue(el, option.value);
  option.selected = true;
  fire(el, 'input', 'change');
  return true;
}

export function fillChoice(group: HTMLInputElement[], labels: string[], value: string, boolean?: boolean): boolean {
  const idx = matchOption(labels, value, boolean);
  if (idx < 0) return false;
  const input = group[idx]!;
  if (!input.checked) input.click();
  if (!input.checked) {
    input.checked = true;
    fire(input, 'input', 'change');
  }
  return true;
}

export function fillCheckboxes(group: HTMLInputElement[], labels: string[], values: string[]): boolean {
  let any = false;
  for (const v of values) {
    const idx = matchOption(labels, v);
    const box = idx >= 0 ? group[idx] : undefined;
    if (box && !box.checked) {
      box.click();
      any = true;
    }
  }
  return any;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Custom dropdowns (React-Select, Workday, Ashby): type, then pick from the listbox. */
export async function fillCombobox(el: HTMLElement, value: string, boolean?: boolean): Promise<boolean> {
  const input = (el.matches('input') ? el : el.querySelector('input')) as HTMLInputElement | null;
  el.click();
  if (input) {
    input.focus();
    setNativeValue(input, boolean === undefined ? value : boolean ? 'Yes' : 'No');
    fire(input, 'input');
  }
  const doc = el.ownerDocument;
  for (let attempt = 0; attempt < 8; attempt++) {
    await wait(60);
    const listboxId = el.getAttribute('aria-controls') || input?.getAttribute('aria-controls');
    const scope = (listboxId && doc.getElementById(listboxId)) || doc;
    const options = Array.from(scope.querySelectorAll<HTMLElement>('[role="option"]'));
    if (!options.length) continue;
    const idx = matchOption(options.map((o) => o.textContent || ''), value, boolean);
    const option = idx >= 0 ? options[idx] : undefined;
    if (option) {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      option.click();
      return true;
    }
    break;
  }
  if (input) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  return false;
}

export type Highlight = 'filled' | 'review';

export function highlight(field: FieldDescriptor, kind: Highlight): void {
  const targets = field.group.length ? field.group.map((i) => (i.closest('label') as HTMLElement) || i) : [field.element];
  for (const t of targets) {
    t.dataset.hustlenFill = kind;
    t.style.outline = kind === 'filled' ? '2px solid rgba(5,150,105,.65)' : '2px solid rgba(217,119,6,.85)';
    t.style.outlineOffset = '2px';
    const clear = () => {
      t.style.outline = '';
      t.style.outlineOffset = '';
      delete t.dataset.hustlenFill;
    };
    t.addEventListener('input', clear, { once: true });
  }
}
