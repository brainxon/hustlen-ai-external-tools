import { storage } from 'wxt/utils/storage';
import type { ExtensionProfile } from './types';

/**
 * Typed wrappers over browser.storage.
 *
 * - session (in memory, cleared when the browser closes): the access token and
 *   the cached profile (PII). The background script widens its access level so
 *   content scripts can read the profile for instant, network-free autofill.
 * - local (persistent, private to the extension): the refresh token, the
 *   selected CV, the user's own screening-answer bank and settings.
 */

export interface TokenSet {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export interface CachedProfile {
  profile: ExtensionProfile;
  fetchedAt: number;
}

/** Answers the user saved once and wants reused for common screening questions. */
export interface AnswerBank {
  workAuthorized: 'yes' | 'no' | '';
  needsSponsorship: 'yes' | 'no' | '';
  willingToRelocate: 'yes' | 'no' | '';
  remotePreference: string;
  noticePeriod: string;
  earliestStartDate: string;
  salaryExpectation: string;
  yearsOfExperience: string;
  howDidYouHear: string;
  website: string;
  github: string;
  // Protected characteristics: only ever filled from what the user chose here.
  gender: string;
  ethnicity: string;
  veteranStatus: string;
  disabilityStatus: string;
  custom: CustomAnswer[];
}

/** A saved answer to a recurring question, typed once by the user (or learned from a form they filled). */
export interface CustomAnswer {
  question: string;
  answer: string;
  /** Control type it was answered in; choice answers are re-matched against the new form's options. */
  kind?: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number';
  /** Exact-match fingerprint on the same site: "<host>|<field name>" (e.g. a Workday automation id). */
  fp?: string;
  updatedAt?: number;
  uses?: number;
}

/** An answer the user typed into a form, waiting for them to confirm saving it. */
export interface LearnedCandidate {
  id: string;
  question: string;
  answer: string;
  kind: CustomAnswer['kind'];
  fp?: string;
  /** Structured answer-bank field it maps to, when it's one of the recurring questions. */
  bankField?: string;
  host: string;
  capturedAt: number;
}

export interface Settings {
  selectedCvSource: string | null;
  /** Extension UI language; 'auto' follows the browser. */
  uiLanguage: 'auto' | 'en' | 'de' | 'es';
  /** Sites (domains) the user paused the extension on. */
  pausedSites: string[];
  /** Remember answers typed in application forms: null = not asked yet (nothing is captured until the user opts in). */
  learnAnswers: boolean | null;
  showInPageButton: boolean;
  useAiForOpenQuestions: boolean;
}

export const EMPTY_ANSWER_BANK: AnswerBank = {
  workAuthorized: '',
  needsSponsorship: '',
  willingToRelocate: '',
  remotePreference: '',
  noticePeriod: '',
  earliestStartDate: '',
  salaryExpectation: '',
  yearsOfExperience: '',
  howDidYouHear: '',
  website: '',
  github: '',
  gender: '',
  ethnicity: '',
  veteranStatus: '',
  disabilityStatus: '',
  custom: [],
};

export const DEFAULT_SETTINGS: Settings = {
  selectedCvSource: null,
  uiLanguage: 'auto',
  pausedSites: [],
  learnAnswers: null,
  showInPageButton: true,
  useAiForOpenQuestions: true,
};

const K = {
  tokens: 'session:tokens',
  refresh: 'local:refreshToken',
  profile: 'session:profile',
  answers: 'local:answerBank',
  settings: 'local:settings',
  learned: 'session:learnedAnswers',
} as const;

export const tokenStore = storage.defineItem<TokenSet | null>(K.tokens, { fallback: null });
export const refreshTokenStore = storage.defineItem<string | null>(K.refresh, { fallback: null });
export const profileStore = storage.defineItem<CachedProfile | null>(K.profile, { fallback: null });
export const answerBankStore = storage.defineItem<AnswerBank>(K.answers, { fallback: EMPTY_ANSWER_BANK });
export const settingsStore = storage.defineItem<Settings>(K.settings, { fallback: DEFAULT_SETTINGS });
/** Answers captured from forms, pending the user's confirmation (in memory; cleared when the browser closes). */
export const learnedStore = storage.defineItem<LearnedCandidate[]>(K.learned, { fallback: [] });

export async function clearSession(): Promise<void> {
  await Promise.all([tokenStore.removeValue(), refreshTokenStore.removeValue(), profileStore.removeValue()]);
}
