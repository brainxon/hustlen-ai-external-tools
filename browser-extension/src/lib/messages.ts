import type { AnswerBank } from './storage';
import type { ExtensionProfile, ExtractedJob, ScreeningAnswer, ScreeningQuestion } from './types';

/** Messages handled by the background script. */
export type BackgroundRequest =
  | { type: 'auth:status' }
  | { type: 'auth:connect' }
  | { type: 'auth:disconnect' }
  | { type: 'auth:token'; force?: boolean }
  | { type: 'profile:get'; refresh?: boolean }
  | { type: 'profile:selectCv'; cvSource: string }
  | { type: 'app:lookup'; url: string }
  | { type: 'app:save'; job: ExtractedJob }
  | { type: 'plan:get' }
  | { type: 'app:markSubmitted'; applicationId: number }
  | { type: 'ai:answer'; questions: ScreeningQuestion[]; job?: Partial<ExtractedJob>; applicationId?: number | null }
  | { type: 'app:coverLetterText'; url: string }
  | { type: 'app:tailoredCv'; url: string }
  | { type: 'tab:scan'; tabId: number }
  | { type: 'tab:autofill'; tabId: number; useAi?: boolean };

export type BackgroundResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string; status?: number };

/** Messages handled by the content script in a tab. */
export type ContentRequest =
  | { type: 'page:scan' }
  | { type: 'page:autofill'; useAi?: boolean }
  | { type: 'page:applyAnswers'; answers: ScreeningAnswer[] };

export interface PageScan {
  job: ExtractedJob | null;
  platform: string;
  formFieldCount: number;
  hasApplicationForm: boolean;
}

export interface AutofillReport {
  filled: number;
  skipped: number;
  fromAnswerBank: number;
  aiAnswered: number;
  needsReview: string[];
  unanswered: ScreeningQuestion[];
  durationMs: number;
  /** A cover-letter text field was found: filled from the tailored letter, or missing (tailor first). */
  coverLetter?: 'filled' | 'missing';
  /** "Add another" blocks opened for extra experience/education entries. */
  sectionsAdded?: number;
  /** The AI answer step was skipped because the plan's AI credits ran out. */
  aiSkipped?: 'credits';
}

export interface AutofillContext {
  profile: ExtensionProfile;
  answers: AnswerBank;
}
