import type { AnswerBank, CustomAnswer, LearnedCandidate } from '../storage';
import type { PlatformAdapter } from './adapters';
import { discoverFields, normalize, type FieldDescriptor } from './fields';
import { classify, type FieldKey } from './matcher';
import { fieldFingerprint, questionSimilarity, siteScope } from './similarity';

/**
 * Learning the user's own answers (the extension's main value): when the
 * user answers a question the extension couldn't fill - or corrects one it
 * did - that answer is offered for saving, so the next form fills it.
 *
 * Privacy by design (Chrome Web Store User Data policy):
 *  - nothing is captured unless the user opted in (Settings, or the first
 *    "remember these answers?" prompt) - values are read from the form only
 *    at submit / next-step time, never keystroke by keystroke;
 *  - captured answers stay pending (session storage) until the user
 *    confirms; saved answers live only in this browser;
 *  - never captured: passwords, payment and bank data, government IDs,
 *    contact data already in the profile, file inputs, consents, and
 *    protected characteristics (gender, ethnicity, disability, veteran) -
 *    those are only ever set explicitly in "My answers".
 */

const NEVER_LEARN_KEYS: FieldKey[] = [
  'first_name', 'last_name', 'middle_name', 'full_name', 'preferred_name', 'email', 'phone', 'phone_country',
  'address', 'city', 'state', 'zip', 'country', 'location', 'linkedin',
  'resume', 'cover_letter', 'consent', 'gender', 'ethnicity', 'veteran', 'disability', 'summary',
  'current_company', 'current_title', 'school', 'degree', 'field_of_study', 'graduation_year',
];

const SENSITIVE = /(password|passwort|contrase|mot de passe|senha|card ?number|credit ?card|kreditkarte|tarjeta|cvv|cvc|security code|expir|iban|bic\b|swift|routing|account number|kontonummer|n[uú]mero de cuenta|ssn|social security|sozialversicherung|seguro social|national (id|insurance)|passport|reisepass|pasaporte|tax ?id|steuer-?id|steuernummer|\bdni\b|\bnie\b|\bnif\b|\bcurp\b|\brut\b|\bcpf\b|\bcnpj\b|codice fiscale|date of birth|geburtsdatum|fecha de nacimiento|birth ?date|\bpin\b|otp|verification code)/i;

/** Structured answer-bank fields a recurring question maps to. */
const BANK_FIELD: Partial<Record<FieldKey, keyof AnswerBank>> = {
  salary: 'salaryExpectation',
  notice_period: 'noticePeriod',
  start_date: 'earliestStartDate',
  years_experience: 'yearsOfExperience',
  remote: 'remotePreference',
  how_did_you_hear: 'howDidYouHear',
  website: 'website',
  github: 'github',
  work_authorization: 'workAuthorized',
  sponsorship: 'needsSponsorship',
  relocate: 'willingToRelocate',
};

const YES_NO_FIELDS = new Set<keyof AnswerBank>(['workAuthorized', 'needsSponsorship', 'willingToRelocate']);

export function isLearnable(field: FieldDescriptor, key: FieldKey | null): boolean {
  if (field.kind === 'file' || field.kind === 'checkbox') return false;
  const el = field.element as HTMLInputElement;
  if (el.type === 'password' || /^cc-|one-time-code|new-password|current-password/.test(field.autocomplete)) return false;
  if (SENSITIVE.test(`${field.label} ${field.hints}`)) return false;
  if (key && NEVER_LEARN_KEYS.includes(key)) return false;
  if (field.label.length < 4) return false;
  if (field.element.closest('[data-hustlen-ui]')) return false;
  return true;
}

/** The user's answer as text: selected option label for choices. */
export function readAnswer(field: FieldDescriptor): string {
  switch (field.kind) {
    case 'select': {
      const s = field.element as HTMLSelectElement;
      const opt = s.options[s.selectedIndex];
      return opt && opt.value !== '' ? normalize(opt.textContent) : '';
    }
    case 'radio': {
      const i = field.group.findIndex((r) => r.checked);
      return i >= 0 ? field.options[i] ?? '' : '';
    }
    case 'checkbox-group':
      return field.group.map((c, i) => (c.checked ? field.options[i] : '')).filter(Boolean).join(', ');
    case 'combobox':
      return normalize((field.element as HTMLInputElement).value ?? field.element.textContent);
    default:
      return ((field.element as HTMLInputElement).value ?? '').trim();
  }
}

function kindOf(field: FieldDescriptor): CustomAnswer['kind'] {
  switch (field.kind) {
    case 'textarea':
      return 'textarea';
    case 'select':
    case 'combobox':
      return 'select';
    case 'radio':
      return 'radio';
    case 'checkbox-group':
      return 'checkbox';
    case 'number':
      return 'number';
    default:
      return 'text';
  }
}

/**
 * Snapshot of what the user answered themselves: fields the extension did
 * not fill, or filled but the user then changed. Read at submit / next-step.
 */
export function captureAnswers(adapter: PlatformAdapter, doc: Document = document, url = location.href): LearnedCandidate[] {
  const scope = adapter.formRoot?.(doc) ?? doc;
  const site = siteScope(url);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const out: LearnedCandidate[] = [];
  for (const field of discoverFields(scope)) {
    const cls = classify(field, adapter.hint?.(field));
    const key = cls?.key ?? null;
    if (!isLearnable(field, key)) continue;
    const answer = readAnswer(field);
    if (!answer || answer.length > 4000) continue;
    const el = field.group[0] ?? field.element;
    const ourValue = el.dataset.hustlenValue; // set by the engine when it fills a field
    if (ourValue !== undefined && ourValue === answer) continue; // our fill, untouched by the user
    const bankField = key ? BANK_FIELD[key] : undefined;
    out.push({
      id: `${Date.now().toString(36)}-${out.length}`,
      question: field.label.slice(0, 500),
      answer,
      kind: kindOf(field),
      fp: fieldFingerprint(site, field.element.getAttribute('name') || field.element.getAttribute('data-automation-id') || field.element.id),
      bankField,
      host,
      capturedAt: Date.now(),
    });
  }
  return out;
}

const YES = /^(yes|ja|s[iíì]|oui|sim|true)\b/i;
const NO = /^(no|nein|non|n[aã]o|false)\b/i;

/** Pending list update: newer answer to the same question replaces the older one. */
export function mergePending(existing: LearnedCandidate[], incoming: LearnedCandidate[], max = 60): LearnedCandidate[] {
  const merged = [...existing];
  for (const c of incoming) {
    const i = merged.findIndex((m) => (c.fp && m.fp === c.fp) || questionSimilarity(m.question, c.question) >= 0.9);
    if (i >= 0) merged[i] = { ...c, id: merged[i]!.id };
    else merged.push(c);
  }
  return merged.slice(-max);
}

/** Answers the bank already knows (same answer to the same question) don't need saving again. */
export function newToBank(candidates: LearnedCandidate[], bank: AnswerBank): LearnedCandidate[] {
  return candidates.filter((c) => {
    if (c.bankField) {
      const current = String(bank[c.bankField as keyof AnswerBank] ?? '');
      if (YES_NO_FIELDS.has(c.bankField as keyof AnswerBank)) {
        const yn = YES.test(c.answer) ? 'yes' : NO.test(c.answer) ? 'no' : '';
        return !!yn && yn !== current;
      }
      return current.trim().toLowerCase() !== c.answer.trim().toLowerCase();
    }
    const known = bank.custom.find((k) => (c.fp && k.fp === c.fp) || questionSimilarity(k.question, c.question) >= 0.9);
    return !known || known.answer.trim() !== c.answer.trim();
  });
}

/** Saves confirmed candidates: recurring questions into their structured field, the rest as custom answers. */
export function saveToBank(bank: AnswerBank, candidates: LearnedCandidate[], maxCustom = 300): AnswerBank {
  const next: AnswerBank = { ...bank, custom: [...bank.custom] };
  for (const c of candidates) {
    const field = c.bankField as keyof AnswerBank | undefined;
    if (field && YES_NO_FIELDS.has(field)) {
      const yn = YES.test(c.answer) ? 'yes' : NO.test(c.answer) ? 'no' : '';
      if (yn) {
        (next as any)[field] = yn;
        continue;
      }
    } else if (field && field !== 'custom') {
      (next as any)[field] = c.answer;
      continue;
    }
    const i = next.custom.findIndex((k) => (c.fp && k.fp === c.fp) || questionSimilarity(k.question, c.question) >= 0.9);
    const item: CustomAnswer = { question: c.question, answer: c.answer, kind: c.kind, fp: c.fp, updatedAt: Date.now(), uses: i >= 0 ? next.custom[i]!.uses ?? 0 : 0 };
    if (i >= 0) next.custom[i] = { ...next.custom[i]!, ...item };
    else next.custom.push(item);
  }
  next.custom = next.custom.slice(-maxCustom);
  return next;
}

// ------------------------------------------------------------- submit / step detection

const SUBMIT_TEXT = /\b(submit|apply|send( application)?|finish|complete|bewerbung (ab)?senden|absenden|bewerben|jetzt bewerben|enviar|postular|postularme|aplicar|candidater|envoyer|postuler|inviare|invia|candidati|candidatar|finalizar|terminar)\b/i;
const NEXT_TEXT = /\b(next|continue|save and continue|review|weiter|fortfahren|siguiente|continuar|suivant|continuer|avanti|continua|próximo|seguinte)\b/i;

export type StepKind = 'submit' | 'next';

/** Classifies a click target as a form submit / next-step button, or null. */
export function stepOf(target: EventTarget | null): StepKind | null {
  const el = (target as HTMLElement | null)?.closest?.('button, input[type="submit"], input[type="button"], [role="button"], a[role="button"]');
  if (!el || el.closest('[data-hustlen-ui]')) return null;
  const text = normalize(`${el.textContent || ''} ${(el as HTMLInputElement).value || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-automation-id') || ''}`);
  if (!text) return null;
  // An explicit type="submit" counts; the implicit default (<button> inside a form) does not - "Cancel" is one too.
  if (SUBMIT_TEXT.test(text) || (el.getAttribute('type') === 'submit' && !NEXT_TEXT.test(text) && !/\b(cancel|back|zurück|abbrechen|cancelar|volver|atr[aá]s|annuler|retour|annulla|indietro|voltar)\b/i.test(text))) return 'submit';
  if (NEXT_TEXT.test(text)) return 'next';
  return null;
}
