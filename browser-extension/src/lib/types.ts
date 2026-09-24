// Shapes returned by the hustlen.ai backend's /api/extension/* endpoints
// (chamba-ai-backend-fastapi#300, fastapi_app/routers/extension/schemas.py).

export interface CvSource {
  key: string;
  kind: 'root' | 'profile';
  label: string;
  language: string | null;
  user_cv_id: number | null;
  root_cv_language: string | null;
  is_default: boolean;
  updated_at: string | null;
}

export interface ContactInfo {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  linkedin_url: string;
  birth_date: string | null;
}

export interface Preferences {
  target_role: string | null;
  years_of_experience: number | null;
  work_preference: string | null;
  preferred_locations: string[];
  salary_min_expectation: number | null;
  salary_max_expectation: number | null;
  salary_currency: string | null;
  job_type_preference: string | null;
}

export interface ExperienceItem {
  job_title: string;
  company: string;
  location: string;
  dates: string;
  start: string | null;
  end: string | null;
  is_current: boolean;
  description: string;
}

export interface EducationItem {
  degree: string;
  institution: string;
  location: string;
  start: string | null;
  end: string | null;
  field_of_study: string;
}

export interface FlatCv {
  source_key: string | null;
  language: string | null;
  professional_title: string;
  summary: string;
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: string[];
  languages: string[];
  certifications: string[];
}

export interface ExtensionProfile {
  user_id: number;
  contact: ContactInfo;
  preferences: Preferences;
  cv_sources: CvSource[];
  cv: FlatCv | null;
}

export interface ScreeningQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'number';
  options: string[];
  max_length?: number | null;
}

export interface ScreeningAnswer {
  id: string;
  answer: string;
  selected_options: string[];
  confidence: number;
  needs_review: boolean;
  reason: string;
}

/** A job posting extracted from the current tab. */
export interface ExtractedJob {
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  source: 'json-ld' | 'adapter' | 'page-text';
  platform: string;
}

export interface DocumentStatus {
  cv_available: boolean;
  cover_letter_available: boolean;
  cv_review_confirmed: boolean;
  cover_letter_review_confirmed: boolean;
}

export type DocumentKind = 'cv' | 'cover_letter';

export interface ApplicationLookup extends Partial<DocumentStatus> {
  found: boolean;
  application_id: number | null;
  status: string | null;
  job_title: string | null;
  company_name: string | null;
}

export type ApplicationStatus =
  | 'Pending' | 'Submitted' | 'Invited' | 'Interviewed' | 'Rejected' | 'Hired' | 'Canceled' | 'Obsolete';
