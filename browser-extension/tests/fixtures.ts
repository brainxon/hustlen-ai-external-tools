import type { AutofillContext } from '@/lib/messages';
import { EMPTY_ANSWER_BANK } from '@/lib/storage';

export function ctx(overrides: Partial<AutofillContext['answers']> = {}): AutofillContext {
  return {
    answers: { ...EMPTY_ANSWER_BANK, ...overrides },
    profile: {
      user_id: 1,
      contact: {
        first_name: 'Ana', last_name: 'García', full_name: 'Ana García', email: 'ana@example.com', phone: '+49 151 2345678',
        street_address: 'Hauptstr. 1', city: 'Berlin', state: 'Berlin', zip_code: '10115', country: 'Germany',
        linkedin_url: 'https://linkedin.com/in/ana', birth_date: null,
      },
      preferences: {
        target_role: 'Backend Engineer', years_of_experience: 6, work_preference: 'hybrid', preferred_locations: ['Berlin'],
        salary_min_expectation: 60000, salary_max_expectation: 70000, salary_currency: 'EUR', job_type_preference: null,
      },
      cv_sources: [{ key: 'root:en', kind: 'root', label: 'Master CV (EN)', language: 'en', user_cv_id: null, root_cv_language: 'en', is_default: true, updated_at: null }],
      cv: {
        source_key: 'root:en', language: 'en', professional_title: 'Backend Engineer', summary: 'Python engineer.',
        experience: [{ job_title: 'Senior Python Developer', company: 'Acme GmbH', location: 'Berlin', dates: '2019 - Present', start: '2019', end: null, is_current: true, description: '' }],
        education: [{ degree: 'BSc Computer Science', institution: 'TU Berlin', location: '', start: '2012', end: '2016', field_of_study: 'CS' }],
        skills: ['Python', 'SQL'], languages: ['German (C1)', 'Spanish (native)'], certifications: [],
      },
    },
  };
}

export function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}
