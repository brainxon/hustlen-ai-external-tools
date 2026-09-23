import type { FieldDescriptor } from '../fields';
import type { FieldKey } from '../matcher';

/**
 * Per-ATS knowledge: where the application form lives, attribute hints
 * that beat label matching, and where the job details are rendered.
 * Everything not covered here falls back to the generic engine.
 */
export interface PlatformAdapter {
  id: string;
  name: string;
  matches(url: URL): boolean;
  /** Narrows autofill to the application form (e.g. LinkedIn's Easy Apply modal). */
  formRoot?(doc: Document): Element | null;
  /** Unambiguous field classification from ATS-specific attributes. */
  hint?(field: FieldDescriptor): FieldKey | null;
  /** DOM selectors for job details when JSON-LD is missing. */
  job?: { title?: string; company?: string; location?: string; description?: string };
  /** Canonical posting URL (e.g. LinkedIn search view -> /jobs/view/<id>). */
  canonicalUrl?(url: URL): string | null;
}

const byAttr = (field: FieldDescriptor, map: [RegExp, FieldKey][]): FieldKey | null => {
  for (const [re, key] of map) if (re.test(field.hints)) return key;
  return null;
};

const host = (url: URL, ...suffixes: string[]) => suffixes.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));

export const ADAPTERS: PlatformAdapter[] = [
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    matches: (u) => host(u, 'greenhouse.io') || u.searchParams.has('gh_jid'),
    formRoot: (d) => d.querySelector('#application-form, #application_form, form#application'),
    hint: (f) =>
      byAttr(f, [
        [/^first_name\b|job_application\[first_name\]/, 'first_name'],
        [/^last_name\b|job_application\[last_name\]/, 'last_name'],
        [/^email\b|job_application\[email\]/, 'email'],
        [/^phone\b|job_application\[phone\]/, 'phone'],
        [/candidate-location|job_application\[location\]/, 'location'],
      ]),
    job: { title: '.job__title h1, .app-title, h1.section-header', company: '.company-name', location: '.job__location, .location', description: '.job__description, #content' },
  },
  {
    id: 'lever',
    name: 'Lever',
    matches: (u) => host(u, 'lever.co'),
    formRoot: (d) => d.querySelector('form#application-form, .application-form, form[action*="apply"]'),
    hint: (f) =>
      byAttr(f, [
        [/^name\b/, 'full_name'],
        [/^email\b/, 'email'],
        [/^phone\b/, 'phone'],
        [/^org\b/, 'current_company'],
        [/urls\[linkedin\]/, 'linkedin'],
        [/urls\[github\]/, 'github'],
        [/urls\[portfolio\]|urls\[other\]/, 'website'],
        [/^location\b/, 'location'],
      ]),
    job: { title: '.posting-headline h2', location: '.posting-categories .location, .sort-by-location', description: '.posting-page .section-wrapper, [data-qa="job-description"]' },
  },
  {
    id: 'workday',
    name: 'Workday',
    matches: (u) => host(u, 'myworkdayjobs.com', 'myworkdaysite.com', 'workday.com'),
    hint: (f) =>
      byAttr(f, [
        [/legalnamesection_firstname|firstname/, 'first_name'],
        [/legalnamesection_lastname|lastname/, 'last_name'],
        [/addresssection_addressline1/, 'address'],
        [/addresssection_city/, 'city'],
        [/addresssection_postalcode/, 'zip'],
        [/addresssection_countryregion/, 'state'],
        [/countrydropdown|addresssection_country\b/, 'country'],
        [/phone-number|phonenumber/, 'phone'],
        [/country-phone-code|phonecode/, 'phone_country'],
        [/\bemail\b/, 'email'],
        [/linkedinquestion|linkedin/, 'linkedin'],
      ]),
    job: { title: '[data-automation-id="jobPostingHeader"]', location: '[data-automation-id="locations"]', description: '[data-automation-id="jobPostingDescription"]' },
  },
  {
    id: 'ashby',
    name: 'Ashby',
    matches: (u) => host(u, 'ashbyhq.com'),
    hint: (f) =>
      byAttr(f, [
        [/_systemfield_name/, 'full_name'],
        [/_systemfield_email/, 'email'],
        [/_systemfield_phone/, 'phone'],
        [/_systemfield_location/, 'location'],
        [/linkedin/, 'linkedin'],
      ]),
    job: { title: 'h1', description: '[class*="descriptionText"], ._descriptionText_' },
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    matches: (u) => host(u, 'smartrecruiters.com'),
    job: { title: 'h1.job-title, h1[itemprop="title"]', company: '[itemprop="hiringOrganization"] [itemprop="name"]', location: '.job-detail-location, [itemprop="jobLocation"]', description: '[itemprop="description"], .job-sections' },
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    matches: (u) => host(u, 'linkedin.com'),
    formRoot: (d) => d.querySelector('.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], .jobs-easy-apply-content'),
    canonicalUrl: (u) => {
      const id = u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
      return id ? `https://www.linkedin.com/jobs/view/${id}/` : null;
    },
    job: {
      title: '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .top-card-layout__title',
      company: '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .topcard__org-name-link',
      location: '.job-details-jobs-unified-top-card__primary-description-container .tvm__text, .topcard__flavor--bullet',
      description: '.jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, #job-details',
    },
  },
  {
    id: 'indeed',
    name: 'Indeed',
    matches: (u) => host(u, 'indeed.com', 'indeed.de', 'indeed.es', 'indeed.com.mx', 'indeed.co.uk') || /(^|\.)indeed\./.test(u.hostname),
    canonicalUrl: (u) => {
      const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
      return jk ? `${u.origin}/viewjob?jk=${jk}` : null;
    },
    job: { title: 'h1.jobsearch-JobInfoHeader-title, [data-testid="jobsearch-JobInfoHeader-title"]', company: '[data-testid="inlineHeader-companyName"], [data-company-name]', location: '[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"]', description: '#jobDescriptionText' },
  },
  {
    id: 'workable',
    name: 'Workable',
    matches: (u) => host(u, 'workable.com'),
    job: { title: 'h1', description: '[data-ui="job-description"]' },
  },
  {
    id: 'personio',
    name: 'Personio',
    matches: (u) => host(u, 'jobs.personio.de', 'jobs.personio.com'),
    job: { title: 'h1', description: '.job-description, [class*="jobDescription"]' },
  },
  {
    id: 'stepstone',
    name: 'StepStone',
    matches: (u) => host(u, 'stepstone.de', 'stepstone.at', 'stepstone.com'),
    job: { title: '[data-at="header-job-title"]', company: '[data-at="header-company-name"]', location: '[data-at="job-ad-location"]', description: '[data-at="job-ad-content"], [data-genesis-element="CARD_CONTENT"]' },
  },
];

export const GENERIC_ADAPTER: PlatformAdapter = { id: 'generic', name: 'Web', matches: () => true };

export function adapterFor(url: URL): PlatformAdapter {
  return ADAPTERS.find((a) => a.matches(url)) ?? GENERIC_ADAPTER;
}

/** Hosts where the content script is declared statically (in-page button, instant autofill). */
export const KNOWN_ATS_MATCHES = [
  '*://*.greenhouse.io/*',
  '*://*.lever.co/*',
  '*://*.myworkdayjobs.com/*',
  '*://*.myworkdaysite.com/*',
  '*://*.ashbyhq.com/*',
  '*://*.smartrecruiters.com/*',
  '*://*.linkedin.com/jobs/*',
  '*://*.workable.com/*',
  '*://*.personio.de/*',
  '*://*.personio.com/*',
  '*://*.stepstone.de/*',
  '*://*.indeed.com/*',
  '*://*.indeed.de/*',
  '*://*.indeed.es/*',
];
