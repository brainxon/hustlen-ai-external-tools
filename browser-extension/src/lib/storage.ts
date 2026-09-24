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
  custom: { question: string; answer: string }[];
}

export interface Settings {
  selectedCvSource: string | null;
  /** Extension UI language; 'auto' follows the browser. */
  uiLanguage: 'auto' | 'en' | 'de' | 'es';
  /** Sites (domains) the user paused the extension on. */
  pausedSites: string[];
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
  showInPageButton: true,
  useAiForOpenQuestions: true,
};

const K = {
  tokens: 'session:tokens',
  refresh: 'local:refreshToken',
  profile: 'session:profile',
  answers: 'local:answerBank',
  settings: 'local:settings',
} as const;

export const tokenStore = storage.defineItem<TokenSet | null>(K.tokens, { fallback: null });
export const refreshTokenStore = storage.defineItem<string | null>(K.refresh, { fallback: null });
export const profileStore = storage.defineItem<CachedProfile | null>(K.profile, { fallback: null });
export const answerBankStore = storage.defineItem<AnswerBank>(K.answers, { fallback: EMPTY_ANSWER_BANK });
export const settingsStore = storage.defineItem<Settings>(K.settings, { fallback: DEFAULT_SETTINGS });

export async function clearSession(): Promise<void> {
  await Promise.all([tokenStore.removeValue(), refreshTokenStore.removeValue(), profileStore.removeValue()]);
}
