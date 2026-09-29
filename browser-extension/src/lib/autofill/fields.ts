/**
 * Field discovery: turns the page's form controls into descriptors with a
 * human label, so the matcher can classify them. Pure DOM, synchronous and
 * cheap - it runs on every autofill and on every new form step.
 */

export type FieldKind =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea'
  | 'select' | 'radio' | 'checkbox' | 'checkbox-group' | 'combobox' | 'file';

export interface FieldDescriptor {
  /** Stable id stamped on the element (data-hustlen-id). */
  id: string;
  kind: FieldKind;
  /** The control to fill. For radio/checkbox groups: the first input. */
  element: HTMLElement;
  /** All inputs of a radio / checkbox group. */
  group: HTMLInputElement[];
  label: string;
  /** name / id / autocomplete / data-automation-id etc., lowercased. */
  hints: string;
  autocomplete: string;
  options: string[];
  required: boolean;
  maxLength: number | null;
}

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color']);
let counter = 0;

export function normalize(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').replace(/[*✱]/g, '').trim();
}

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  // Ignore nested controls' own text (e.g. <label>Country <select>…</select></label>).
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('select, option, input, textarea, script, style, [aria-hidden="true"]').forEach((n) => n.remove());
  return normalize(clone.textContent);
}

function byIds(root: Document | ShadowRoot, ids: string | null): string {
  if (!ids) return '';
  return ids
    .split(/\s+/)
    .map((id) => textOf((root as Document).getElementById?.(id) ?? root.querySelector(`#${CSS.escape(id)}`)))
    .filter(Boolean)
    .join(' ');
}

/**
 * Best human-readable label for a control, trying the most reliable sources
 * first. For radio/checkbox groups (`asGroup`) the control's own label is
 * just an option ("Yes"), so the question comes from the group instead.
 */
export function labelFor(el: HTMLElement, asGroup = false): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  if (!asGroup) {
    const labelled = byIds(root, el.getAttribute('aria-labelledby'));
    if (labelled) return labelled;

    const aria = normalize(el.getAttribute('aria-label'));
    if (aria) return aria;

    if (el.id) {
      const explicit = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (explicit && textOf(explicit)) return textOf(explicit);
    }
    const wrapping = el.closest('label');
    if (wrapping && textOf(wrapping)) return textOf(wrapping);
  }

  // Radio/checkbox groups: the fieldset legend or group label is the question.
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend && textOf(legend)) return textOf(legend);
  const group = el.closest('[role="group"], [role="radiogroup"]');
  if (group) {
    const g = byIds(root, group.getAttribute('aria-labelledby')) || normalize(group.getAttribute('aria-label'));
    if (g) return g;
  }

  // Nearest preceding text in the field's container (common in custom ATS forms).
  let node: HTMLElement | null = asGroup ? (el.closest('label')?.parentElement ?? el) : el;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const candidate = node.querySelector('label, legend, [class*="label" i], [class*="question" i], h3, h4, p');
    if (candidate && !candidate.contains(el) && candidate.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      const t = textOf(candidate);
      if (t && t.length < 300) return t;
    }
  }

  return normalize(el.getAttribute('placeholder')) || normalize(el.getAttribute('title')) || '';
}

function hintsFor(el: HTMLElement): string {
  return ['name', 'id', 'autocomplete', 'data-automation-id', 'data-testid', 'data-qa', 'data-field', 'placeholder']
    .map((a) => el.getAttribute(a) || '')
    .join(' ')
    .toLowerCase();
}

function isVisible(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  // jsdom has no layout; real browsers: zero-size and not a styled radio/checkbox proxy.
  const rect = el.getBoundingClientRect();
  const hasLayout = rect.width > 0 || rect.height > 0;
  const type = (el as HTMLInputElement).type;
  const noLayoutEngine = el.ownerDocument.defaultView?.navigator.userAgent.includes('jsdom') ?? false;
  return hasLayout || noLayoutEngine || type === 'radio' || type === 'checkbox' || type === 'file';
}

function stamp(el: HTMLElement): string {
  if (!el.dataset.hustlenId) el.dataset.hustlenId = `h${++counter}`;
  return el.dataset.hustlenId;
}

function optionLabel(input: HTMLInputElement): string {
  const root = input.getRootNode() as Document | ShadowRoot;
  if (input.id) {
    const l = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (l && textOf(l)) return textOf(l);
  }
  const wrap = input.closest('label');
  if (wrap && textOf(wrap)) return textOf(wrap);
  return normalize(input.getAttribute('aria-label')) || normalize(input.nextElementSibling?.textContent) || input.value;
}

/** Every element root reachable from `root`, including open shadow roots. */
function roots(root: Document | ShadowRoot | Element): (Document | ShadowRoot | Element)[] {
  const out: (Document | ShadowRoot | Element)[] = [root];
  const walker = (root as Document).createTreeWalker
    ? (root as Document).createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT)
    : (root as Element).ownerDocument!.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    if ((node as HTMLElement).shadowRoot) out.push(...roots((node as HTMLElement).shadowRoot!));
    node = walker.nextNode() as Element | null;
  }
  return out;
}

export function discoverFields(scope: Document | Element = document): FieldDescriptor[] {
  const fields: FieldDescriptor[] = [];
  const seenGroups = new Set<string>();

  for (const root of roots(scope)) {
    const controls = root.querySelectorAll<HTMLElement>('input, textarea, select, [role="combobox"]:not(input)');
    for (const el of Array.from(controls)) {
      if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) continue;
      // Site chrome (global search, newsletter boxes in nav/footer) is never part of an application.
      if (el.closest('[role="search"], nav, footer, [data-hustlen-ui]')) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
      if (tag === 'input' && SKIP_INPUT_TYPES.has(type)) continue;
      if (!isVisible(el) && type !== 'file') continue;

      let kind: FieldKind;
      let group: HTMLInputElement[] = [];
      let options: string[] = [];
      let element: HTMLElement = el;

      if (tag === 'select') {
        kind = 'select';
        options = Array.from((el as HTMLSelectElement).options)
          .filter((o) => o.value !== '' && !o.disabled)
          .map((o) => normalize(o.textContent))
          .filter(Boolean);
      } else if (tag === 'textarea') {
        kind = 'textarea';
      } else if (type === 'radio' || type === 'checkbox') {
        const input = el as HTMLInputElement;
        const container = input.closest('fieldset, [role="radiogroup"], [role="group"]');
        const groupKey = input.name ? `n:${input.name}` : container ? `c:${stamp(container as HTMLElement)}` : `s:${stamp(input)}`;
        if (seenGroups.has(groupKey)) continue;
        seenGroups.add(groupKey);
        const selector = `input[type="${type}"]`;
        group = input.name
          ? Array.from(root.querySelectorAll<HTMLInputElement>(`${selector}[name="${CSS.escape(input.name)}"]`))
          : container
            ? Array.from(container.querySelectorAll<HTMLInputElement>(selector))
            : [input];
        options = group.map(optionLabel);
        kind = type === 'radio' ? 'radio' : group.length > 1 ? 'checkbox-group' : 'checkbox';
        element = group[0] ?? input;
      } else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') {
        kind = 'combobox';
      } else if (['email', 'tel', 'url', 'number', 'date', 'file'].includes(type)) {
        kind = type as FieldKind;
      } else {
        kind = 'text';
      }

      const single = kind === 'checkbox';
      fields.push({
        id: stamp(element),
        kind,
        element,
        group,
        // A lone checkbox's own label is the statement ("I agree to…"); a group's label is the question.
        label: single
          ? optionLabel(element as HTMLInputElement) || labelFor(element)
          : labelFor(element, kind === 'radio' || kind === 'checkbox-group'),
        hints: hintsFor(element),
        autocomplete: (element.getAttribute('autocomplete') || '').toLowerCase(),
        options,
        required: (element as HTMLInputElement).required || element.getAttribute('aria-required') === 'true',
        maxLength: (element as HTMLInputElement).maxLength > 0 ? (element as HTMLInputElement).maxLength : null,
      });
    }
  }
  return fields;
}

/** True when the field already holds a user/ATS-provided value we must not overwrite. */
export function hasValue(field: FieldDescriptor): boolean {
  const el = field.element as HTMLInputElement;
  switch (field.kind) {
    case 'radio':
    case 'checkbox-group':
      return field.group.some((i) => i.checked);
    case 'checkbox':
      return el.checked;
    case 'select': {
      const s = field.element as HTMLSelectElement;
      return s.selectedIndex > 0 || (s.selectedIndex === 0 && s.options[0]?.value !== '' && !/select|choose|wähl|selecc|--/i.test(s.options[0]?.textContent || ''));
    }
    case 'file':
      return (el.files?.length ?? 0) > 0;
    default:
      return (el.value ?? '').trim() !== '';
  }
}
