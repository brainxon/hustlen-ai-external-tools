import type { AutofillContext } from '../messages';
import type { FieldKey } from './matcher';

/**
 * Maps a classified field to the value to fill, from the cached profile
 * (contact, preferences, selected CV) and the user's own answer bank.
 * Returns null when there is nothing trustworthy to fill - an empty field
 * is always better than a wrong one.
 */

export interface ResolvedValue {
  value: string;
  /** Where it came from - shown in the fill report and used for highlighting. */
  source: 'profile' | 'cv' | 'answer-bank';
  /** Values from the answer bank for yes/no style questions. */
  boolean?: boolean;
}

const WORK_PREFERENCE_LABEL: Record<string, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  remote_future: 'Remote',
};

function yesNo(v: 'yes' | 'no' | ''): ResolvedValue | null {
  if (!v) return null;
  return { value: v === 'yes' ? 'Yes' : 'No', boolean: v === 'yes', source: 'answer-bank' };
}

function nonEmpty(value: string | null | undefined, source: ResolvedValue['source']): ResolvedValue | null {
  const v = (value ?? '').toString().trim();
  return v ? { value: v, source } : null;
}

export function resolveValue(key: FieldKey, ctx: AutofillContext): ResolvedValue | null {
  const { contact: c, preferences: p, cv } = ctx.profile;
  const a = ctx.answers;
  const latest = cv?.experience?.[0];
  const edu = cv?.education?.[0];

  switch (key) {
    case 'first_name':
      return nonEmpty(c.first_name, 'profile');
    case 'last_name':
      return nonEmpty(c.last_name, 'profile');
    case 'full_name':
      return nonEmpty(c.full_name, 'profile');
    case 'preferred_name':
      return nonEmpty(c.first_name, 'profile');
    case 'middle_name':
      return null;
    case 'email':
      return nonEmpty(c.email, 'profile');
    case 'phone':
      return nonEmpty(c.phone, 'profile');
    case 'phone_country': {
      const m = c.phone.match(/^\s*(\+\d{1,3})/);
      return m?.[1] ? { value: m[1], source: 'profile' } : null;
    }
    case 'address':
      return nonEmpty(c.street_address, 'profile');
    case 'city':
      return nonEmpty(c.city, 'profile');
    case 'state':
      return nonEmpty(c.state, 'profile');
    case 'zip':
      return nonEmpty(c.zip_code, 'profile');
    case 'country':
      return nonEmpty(c.country, 'profile');
    case 'location':
      return nonEmpty([c.city, c.state || '', c.country].filter(Boolean).join(', '), 'profile');
    case 'linkedin':
      return nonEmpty(c.linkedin_url, 'profile');
    case 'website':
      return nonEmpty(a.website, 'answer-bank');
    case 'github':
      return nonEmpty(a.github, 'answer-bank');
    case 'twitter':
      return null;
    case 'current_company':
      return latest?.is_current ? nonEmpty(latest.company, 'cv') : null;
    case 'current_title':
      return latest?.is_current ? nonEmpty(latest.job_title, 'cv') : nonEmpty(p.target_role, 'profile');
    case 'headline':
      return nonEmpty(cv?.professional_title || latest?.job_title, 'cv');
    case 'summary':
      return nonEmpty(cv?.summary, 'cv');
    case 'years_experience':
      return nonEmpty(a.yearsOfExperience || (p.years_of_experience != null ? String(p.years_of_experience) : ''), a.yearsOfExperience ? 'answer-bank' : 'profile');
    case 'salary': {
      if (a.salaryExpectation) return { value: a.salaryExpectation, source: 'answer-bank' };
      const amount = p.salary_max_expectation ?? p.salary_min_expectation;
      return amount != null ? { value: String(amount), source: 'profile' } : null;
    }
    case 'notice_period':
      return nonEmpty(a.noticePeriod, 'answer-bank');
    case 'start_date':
      return nonEmpty(a.earliestStartDate, 'answer-bank');
    case 'work_authorization':
      return yesNo(a.workAuthorized);
    case 'sponsorship':
      return yesNo(a.needsSponsorship);
    case 'relocate':
      return yesNo(a.willingToRelocate);
    case 'remote':
      return nonEmpty(a.remotePreference || (p.work_preference ? WORK_PREFERENCE_LABEL[p.work_preference] ?? '' : ''), a.remotePreference ? 'answer-bank' : 'profile');
    case 'how_did_you_hear':
      return nonEmpty(a.howDidYouHear, 'answer-bank');
    case 'school':
      return nonEmpty(edu?.institution, 'cv');
    case 'degree':
      return nonEmpty(edu?.degree, 'cv');
    case 'field_of_study':
      return nonEmpty(edu?.field_of_study, 'cv');
    case 'graduation_year': {
      const y = (edu?.end || '').match(/\d{4}/);
      return y ? { value: y[0], source: 'cv' } : null;
    }
    case 'languages':
      return nonEmpty(cv?.languages?.join(', '), 'cv');
    case 'skills':
      return nonEmpty(cv?.skills?.slice(0, 20).join(', '), 'cv');
    // Protected characteristics: only what the user explicitly chose in the answer bank.
    case 'gender':
      return nonEmpty(a.gender, 'answer-bank');
    case 'ethnicity':
      return nonEmpty(a.ethnicity, 'answer-bank');
    case 'veteran':
      return nonEmpty(a.veteranStatus, 'answer-bank');
    case 'disability':
      return nonEmpty(a.disabilityStatus, 'answer-bank');
    // Never auto-filled: file uploads, cover letters (tailored per job) and legal consent.
    case 'resume':
    case 'cover_letter':
    case 'consent':
      return null;
  }
}
