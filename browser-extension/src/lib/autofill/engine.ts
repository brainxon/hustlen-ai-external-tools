import type { AnswerBank } from '../storage';
import type { AutofillContext, AutofillReport } from '../messages';
import type { ScreeningAnswer, ScreeningQuestion } from '../types';
import type { PlatformAdapter } from './adapters';
import { discoverFields, hasValue, normalize, type FieldDescriptor } from './fields';
import { fillCheckboxes, fillChoice, fillCombobox, fillSelect, fillText, highlight } from './fill';
import { classify, type FieldKey } from './matcher';
import { resolveValue, type ResolvedValue } from './values';

/**
 * Local, synchronous-first autofill. Classification + filling run with no
 * network call (the profile is already cached), so a typical form fills
 * in a few milliseconds; only custom comboboxes wait for their dropdown.
 * Whatever can't be answered from the profile or answer bank comes back
 * as `unanswered` screening questions for the optional AI step.
 */

const byId = new Map<string, FieldDescriptor>();

export function questionType(field: FieldDescriptor): ScreeningQuestion['type'] {
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

function tokens(s: string): Set<string> {
  return new Set(normalize(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((t) => t.length > 2));
}

/** Saved custom Q&A whose question is close enough (token Jaccard ≥ 0.6). */
export function matchCustomAnswer(label: string, bank: AnswerBank): string | null {
  const q = tokens(label);
  let best: { score: number; answer: string } | null = null;
  for (const item of bank.custom) {
    const t = tokens(item.question);
    const inter = [...q].filter((x) => t.has(x)).length;
    const score = inter / (q.size + t.size - inter || 1);
    if (score >= 0.6 && (!best || score > best.score)) best = { score, answer: item.answer };
  }
  return best?.answer ?? null;
}

async function write(field: FieldDescriptor, resolved: ResolvedValue): Promise<boolean> {
  const { value, boolean } = resolved;
  switch (field.kind) {
    case 'select':
      return fillSelect(field.element as HTMLSelectElement, value, boolean);
    case 'radio':
      return fillChoice(field.group, field.options, value, boolean);
    case 'checkbox-group':
      return fillCheckboxes(field.group, field.options, value.split(/\s*,\s*/));
    case 'checkbox':
      return false; // single checkboxes are consents/acknowledgements - the user ticks those
    case 'combobox':
      return fillCombobox(field.element, value, boolean);
    case 'file':
      return false;
    default:
      return fillText(field.element as HTMLInputElement, value, field.maxLength);
  }
}

const NEVER_ASK_AI: FieldKey[] = ['consent', 'resume', 'cover_letter', 'gender', 'ethnicity', 'veteran', 'disability', 'work_authorization', 'sponsorship'];

export interface CoverLetterSource {
  text: string;
  /** Review confirmed in hustlen.ai - otherwise the field is outlined for review. */
  reviewed: boolean;
}

export interface AutofillOptions {
  /** Called lazily, at most once, only when a cover-letter TEXT field is present. */
  getCoverLetter?: () => Promise<CoverLetterSource | null>;
}

const TEXT_KINDS = new Set(['textarea', 'text']);

export async function runAutofill(
  ctx: AutofillContext,
  adapter: PlatformAdapter,
  doc: Document = document,
  options: AutofillOptions = {},
): Promise<AutofillReport> {
  const started = performance.now();
  const scope = adapter.formRoot?.(doc) ?? doc;
  const fields = discoverFields(scope);
  const report: AutofillReport = { filled: 0, skipped: 0, fromAnswerBank: 0, aiAnswered: 0, needsReview: [], unanswered: [], durationMs: 0 };

  let coverLetter: Promise<CoverLetterSource | null> | null = null;

  for (const field of fields) {
    byId.set(field.id, field);
    if (hasValue(field)) {
      report.skipped++;
      continue;
    }
    const cls = classify(field, adapter.hint?.(field));

    // Cover letter asked as a text field (some forms do, instead of an upload):
    // fill it with the tailored cover letter for this job, if there is one.
    if (cls?.key === 'cover_letter' && TEXT_KINDS.has(field.kind)) {
      coverLetter ??= options.getCoverLetter ? options.getCoverLetter().catch(() => null) : Promise.resolve(null);
      const cl = await coverLetter;
      if (cl?.text && fillText(field.element as HTMLTextAreaElement, cl.text, field.maxLength)) {
        report.filled++;
        report.coverLetter = 'filled';
        highlight(field, cl.reviewed ? 'filled' : 'review');
        if (!cl.reviewed) report.needsReview.push(field.label || 'Cover letter');
      } else {
        report.coverLetter = 'missing';
      }
      continue;
    }
    const resolved = cls ? resolveValue(cls.key, ctx) : null;
    const custom = !resolved && field.label ? matchCustomAnswer(field.label, ctx.answers) : null;

    if (resolved || custom) {
      const value = resolved ?? { value: custom!, source: 'answer-bank' as const };
      if (await write(field, value)) {
        report.filled++;
        if (value.source === 'answer-bank') report.fromAnswerBank++;
        highlight(field, 'filled');
        continue;
      }
    }

    if (field.required && cls && NEVER_ASK_AI.includes(cls.key)) {
      report.needsReview.push(field.label || field.id);
      highlight(field, 'review');
      continue;
    }
    // Unclassified (or classified but nothing to fill) questions with a real label go to the AI step.
    const askable = field.label.length > 3 && field.kind !== 'file' && field.kind !== 'checkbox' && !(cls && NEVER_ASK_AI.includes(cls.key));
    if (askable && (!cls || !['first_name', 'last_name', 'full_name', 'email', 'phone', 'address', 'zip'].includes(cls.key))) {
      report.unanswered.push({
        id: field.id,
        label: field.label.slice(0, 2000),
        type: questionType(field),
        options: field.options.slice(0, 100),
        max_length: field.maxLength,
      });
    }
  }

  report.durationMs = Math.round(performance.now() - started);
  return report;
}

/** Fills the AI's drafted answers; anything flagged needs_review is highlighted amber, not green. */
export async function applyAnswers(answers: ScreeningAnswer[]): Promise<{ applied: number; review: number }> {
  let applied = 0;
  let review = 0;
  for (const a of answers) {
    const field = byId.get(a.id);
    if (!field || hasValue(field)) continue;
    const value = a.selected_options.length && field.kind === 'checkbox-group' ? a.selected_options.join(', ') : a.answer;
    if (!value) {
      highlight(field, 'review');
      review++;
      continue;
    }
    if (await write(field, { value, source: 'cv' })) {
      applied++;
      highlight(field, a.needs_review ? 'review' : 'filled');
      if (a.needs_review) review++;
    }
  }
  return { applied, review };
}

export function countFormFields(adapter: PlatformAdapter, doc: Document = document): number {
  const scope = adapter.formRoot?.(doc) ?? doc;
  return discoverFields(scope).filter((f) => f.kind !== 'file').length;
}
