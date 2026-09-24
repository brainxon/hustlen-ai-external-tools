import type { AnswerBank, CustomAnswer } from '../storage';
import { normalize } from './fields';

/**
 * Question matching for saved answers. Simplify-style tools only reuse an
 * answer for the *exact* same question text; here questions match across
 * wording, punctuation, accents, filler words and languages' stopwords,
 * and an exact field fingerprint on the same site wins outright.
 */

const STOPWORDS = new Set(
  (
    // en
    'a an the of to in on at for by with from and or is are be been do does did you your yours we our us i me my this that these those ' +
    'it its as if any please kindly would will can could should have has had what which who whom how when where why there here ' +
    // de
    'der die das den dem des ein eine einer eines einem und oder ist sind sie ihr ihre ihren wir unser ich mich mein zu im in am an ' +
    'auf für mit von bei bitte haben hat wie was wann wo warum welche welcher welches ' +
    // es
    'el la los las un una unos unas de del al y o es son usted tu tus su sus nosotros nuestro yo mi para por con en que cual cuál como cómo ' +
    'cuando dónde donde por qué favor tiene tienes ha han ' +
    // fr
    'le la les un une des du de et ou est sont vous votre vos nous notre je mon ma mes pour par avec dans que quel quelle comment ' +
    // pt / it
    'o os as um uma do da dos das e ou é são você seu sua nós nosso eu meu para por com em que qual como il lo gli i una di del della ' +
    'e o è sono lei suo sua noi nostro io mio per con che quale come'
  ).split(/\s+/),
);

function stem(token: string): string {
  // Deliberately light: plural/inflection endings shared by en/de/es/fr/pt/it.
  return token.length > 4 ? token.replace(/(ies|es|en|er|s|e|n)$/, '') : token;
}

export function questionTokens(text: string): string[] {
  return normalize(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** 0..1 - Dice coefficient, boosted when one question contains the other (≥ 3 meaningful words). */
export function questionSimilarity(a: string, b: string): number {
  const ta = new Set(questionTokens(a));
  const tb = new Set(questionTokens(b));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const dice = (2 * inter) / (ta.size + tb.size);
  const smaller = Math.min(ta.size, tb.size);
  const containment = smaller >= 3 ? inter / smaller : 0;
  return Math.max(dice, containment * 0.95);
}

export const MATCH_THRESHOLD = 0.62;

export interface MatchContext {
  label: string;
  /** "<host>|<name>" of the field being filled. */
  fp?: string;
}

/** Best saved answer for a question, or null. */
export function findSavedAnswer(ctx: MatchContext, bank: AnswerBank): CustomAnswer | null {
  if (ctx.fp) {
    const exact = bank.custom.find((c) => c.fp && c.fp === ctx.fp);
    if (exact) return exact;
  }
  let best: { score: number; item: CustomAnswer } | null = null;
  for (const item of bank.custom) {
    const score = questionSimilarity(ctx.label, item.question);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { score, item };
  }
  return best?.item ?? null;
}

/**
 * Site scope for fingerprints: host + first path segment, because shared
 * ATS hosts serve many companies (boards.greenhouse.io/<company>,
 * jobs.lever.co/<company>, jobs.ashbyhq.com/<company>).
 */
export function siteScope(url: string): string {
  try {
    const u = new URL(url);
    const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
    return `${u.hostname.replace(/^www\./, '')}/${first}`.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Stable field name worth an exact match on the same site. Skips generic
 * ("field_12", "input"), generated (React/MUI ids, hashes) and indexed
 * names ("answers_attributes[0]"), which repeat across different
 * questions and companies.
 */
export function fieldFingerprint(scope: string, name: string | null | undefined): string | undefined {
  const n = (name || '').trim();
  if (!scope || !n || n.length < 4) return undefined;
  if (/^(input|field|text|q|question|answer)?[-_]?\d{0,3}$/i.test(n)) return undefined;
  if (/^:r\w+:$|^react-|^mui-|^[a-f0-9-]{16,}$/i.test(n)) return undefined;
  if (/\[\d+\]|(^|[_-])\d{1,3}([_-]|$)/.test(n)) return undefined;
  return `${scope}|${n}`;
}
