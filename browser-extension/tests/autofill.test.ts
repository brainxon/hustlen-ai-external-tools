import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_ADAPTER, adapterFor } from '@/lib/autofill/adapters';
import { applyAnswers, matchCustomAnswer, runAutofill } from '@/lib/autofill/engine';
import { discoverFields } from '@/lib/autofill/fields';
import { matchOption } from '@/lib/autofill/fill';
import { classify } from '@/lib/autofill/matcher';
import { ctx, mount } from './fixtures';

const value = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

describe('classify', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it.each([
    ['<label for="a">First name</label><input id="a">', 'first_name'],
    ['<label for="a">Vorname</label><input id="a">', 'first_name'],
    ['<label for="a">Apellidos</label><input id="a">', 'last_name'],
    ['<label for="a">Correo electrónico</label><input id="a">', 'email'],
    ['<label for="a">Handynummer</label><input id="a">', 'phone'],
    ['<label for="a">Postleitzahl</label><input id="a">', 'zip'],
    ['<label for="a">LinkedIn Profile URL</label><input id="a">', 'linkedin'],
    ['<input id="a" autocomplete="family-name" placeholder="whatever">', 'last_name'],
    ['<label for="a">Are you legally authorized to work in Germany?</label><select id="a"><option>Yes</option><option>No</option></select>', 'work_authorization'],
    ['<label for="a">Will you now or in the future require sponsorship for employment visa status?</label><input id="a">', 'sponsorship'],
    ['<label for="a">Gehaltsvorstellung</label><input id="a">', 'salary'],
    ['<label for="a">Gender</label><select id="a"><option>Female</option></select>', 'gender'],
    ['<label><input type="checkbox" id="a"> I agree to the privacy policy</label>', 'consent'],
  ])('%s -> %s', (html, key) => {
    mount(html);
    const [field] = discoverFields();
    expect(classify(field!)?.key).toBe(key);
  });

  it('does not treat a long open question as a name field', () => {
    mount('<label for="q">Tell us about a project where you had to name the trade-offs you made</label><textarea id="q"></textarea>');
    expect(classify(discoverFields()[0]!)).toBeNull();
  });

  it('ignores site search boxes in the nav', () => {
    mount('<nav><input aria-label="Search jobs"></nav><form><label for="e">Email</label><input id="e"></form>');
    expect(discoverFields().map((f) => f.label)).toEqual(['Email']);
  });
});

describe('matchOption', () => {
  it('maps country aliases across languages', () => {
    expect(matchOption(['Austria', 'Deutschland', 'Spain'], 'Germany')).toBe(1);
  });
  it('picks yes/no and sentence-style options', () => {
    expect(matchOption(['Yes', 'No'], 'No', false)).toBe(1);
    expect(matchOption(['Ja', 'Nein'], 'Yes', true)).toBe(0);
    expect(matchOption(['I will require sponsorship', 'I will not require sponsorship'], 'No', false)).toBe(1);
  });
  it('picks the numeric range that contains the value', () => {
    expect(matchOption(['0-2 years', '3-5 years', '6-10 years', '10+ years'], '6')).toBe(2);
    expect(matchOption(['Less than 1', '1 to 3', 'More than 3'], '6')).toBe(2);
  });
});

describe('runAutofill', () => {
  it('fills a generic form locally, never overwrites, never ticks consent', async () => {
    mount(`
      <form>
        <label for="fn">First name *</label><input id="fn" name="first_name">
        <label for="ln">Last name</label><input id="ln">
        <label for="em">Email</label><input id="em" type="email" value="keep@me.com">
        <label for="ph">Phone</label><input id="ph" type="tel">
        <label for="co">Country</label><select id="co"><option value="">Select…</option><option value="AT">Austria</option><option value="DE">Germany</option></select>
        <fieldset><legend>Are you willing to relocate?</legend>
          <label><input type="radio" name="rel" value="y"> Yes</label><label><input type="radio" name="rel" value="n"> No</label></fieldset>
        <label for="why">Why do you want to work at Globex?</label><textarea id="why"></textarea>
        <label><input type="checkbox" id="gdpr" required> I agree to the privacy policy</label>
      </form>`);
    const report = await runAutofill(ctx({ willingToRelocate: 'no' }), GENERIC_ADAPTER);

    expect(value('#fn')).toBe('Ana');
    expect(value('#ln')).toBe('García');
    expect(value('#em')).toBe('keep@me.com');
    expect(value('#ph')).toBe('+49 151 2345678');
    expect(value('#co')).toBe('DE');
    expect((document.querySelector('input[value="n"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#gdpr') as HTMLInputElement).checked).toBe(false);
    expect(report.unanswered.map((q) => q.label)).toEqual(['Why do you want to work at Globex?']);
    expect(report.skipped).toBe(1);
    expect(report.durationMs).toBeLessThan(200);
  });

  it('works with React-controlled inputs (native setter + input event)', async () => {
    mount('<label for="fn">First name</label><input id="fn">');
    const el = document.querySelector('#fn') as HTMLInputElement;
    const onInput = vi.fn();
    el.addEventListener('input', () => onInput(el.value));
    await runAutofill(ctx(), GENERIC_ADAPTER);
    expect(onInput).toHaveBeenCalledWith('Ana');
  });

  it('uses Workday automation ids even without labels', async () => {
    document.body.innerHTML = '<input data-automation-id="legalNameSection_firstName"><input data-automation-id="addressSection_city">';
    const adapter = adapterFor(new URL('https://acme.wd3.myworkdayjobs.com/en-US/careers/job/123/apply'));
    expect(adapter.id).toBe('workday');
    await runAutofill(ctx(), adapter);
    const [first, city] = Array.from(document.querySelectorAll('input'));
    expect(first!.value).toBe('Ana');
    expect(city!.value).toBe('Berlin');
  });

  it('flags required legal questions without an answer-bank value for review, never for AI', async () => {
    mount('<label for="a">Are you legally authorized to work in the EU?</label><select id="a" required><option value="">--</option><option>Yes</option><option>No</option></select>');
    const report = await runAutofill(ctx(), GENERIC_ADAPTER);
    expect(report.needsReview).toHaveLength(1);
    expect(report.unanswered).toHaveLength(0);
  });

  it('reuses saved custom answers for similar questions', () => {
    const bank = ctx({ custom: [{ question: 'Why do you want to join our company?', answer: 'Because…' }] }).answers;
    expect(matchCustomAnswer('Why do you want to join the company?', bank)).toBe('Because…');
    expect(matchCustomAnswer('Describe your biggest failure', bank)).toBeNull();
  });

  it('applies AI answers and keeps needs_review ones highlighted for review', async () => {
    mount('<label for="why">Why us?</label><textarea id="why"></textarea><label for="k">Kubernetes?</label><select id="k"><option value="">--</option><option>Yes</option><option>No</option></select>');
    const report = await runAutofill(ctx(), GENERIC_ADAPTER);
    const [why, k] = report.unanswered;
    const res = await applyAnswers([
      { id: why!.id, answer: 'I built FastAPI services at Acme.', selected_options: [], confidence: 0.8, needs_review: false, reason: '' },
      { id: k!.id, answer: '', selected_options: [], confidence: 0, needs_review: true, reason: 'not in CV' },
    ]);
    expect(value('#why')).toBe('I built FastAPI services at Acme.');
    expect(value('#k')).toBe('');
    expect(res).toEqual({ applied: 1, review: 1 });
    expect((document.querySelector('#k') as HTMLElement).dataset.hustlenFill).toBe('review');
  });
});

describe('stem rules match inflections and compounds', () => {
  it.each([
    ['Are you willing to relocate?', 'relocate'],
    ['Relocation assistance needed?', 'relocate'],
    ['Do you require visa sponsorship?', 'sponsorship'],
    ['Disability status', 'disability'],
    ['Ethnicity', 'ethnicity'],
    ['Datenschutzerklärung gelesen', 'consent'],
    ['Telefonnummer', 'phone'],
  ])('%s -> %s', (label, key) => {
    mount(`<label for="x">${label}</label><input id="x">`);
    expect(classify(discoverFields()[0]!)?.key).toBe(key);
  });
});

describe('cover letter as a text field', () => {
  it('fills a cover-letter textarea from the tailored letter, lazily and once; never a file input', async () => {
    mount(`
      <label for="cl">Cover letter (Optional)</label><textarea id="cl"></textarea>
      <label for="clf">Cover letter</label><input id="clf" type="file">
      <label for="cl2">Motivationsschreiben</label><textarea id="cl2"></textarea>`);
    const getCoverLetter = vi.fn(async () => ({ text: 'Dear team,\n\nI am excited…', reviewed: false }));
    const report = await runAutofill(ctx(), GENERIC_ADAPTER, document, { getCoverLetter });
    expect(getCoverLetter).toHaveBeenCalledTimes(1);
    expect(value('#cl')).toBe('Dear team,\n\nI am excited…');
    expect(value('#cl2')).toBe('Dear team,\n\nI am excited…');
    expect((document.querySelector('#clf') as HTMLInputElement).files?.length ?? 0).toBe(0);
    expect(report.coverLetter).toBe('filled');
    expect((document.querySelector('#cl') as HTMLElement).dataset.hustlenFill).toBe('review'); // not reviewed yet
  });

  it('reports missing when the job has no tailored letter, and never asks for it without a text field', async () => {
    mount('<label for="cl">Cover letter</label><textarea id="cl"></textarea>');
    const report = await runAutofill(ctx(), GENERIC_ADAPTER, document, { getCoverLetter: async () => null });
    expect(report.coverLetter).toBe('missing');
    expect(value('#cl')).toBe('');
    expect(report.unanswered).toHaveLength(0); // not sent to the AI screening step either

    mount('<label for="fn">First name</label><input id="fn">');
    const spy = vi.fn();
    await runAutofill(ctx(), GENERIC_ADAPTER, document, { getCoverLetter: spy });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Workable-style modal form (igwork.gr)', () => {
  it('fills unlabeled fields by name and reads radio questions from aria-labelledby', async () => {
    mount(`
      <div role="dialog">
        <span id="firstname_label">First name</span><input name="firstname" aria-labelledby="firstname_label">
        <input name="lastname"><input name="email" type="email"><input name="phone" type="tel">
        <input name="city"><input name="postcode"><input name="country">
        <label for="s">Summary (Optional)</label><textarea id="s" name="summary"></textarea>
        <span id="q1_label">Are you willing to relocate to Athens?</span>
        <div role="radiogroup" aria-labelledby="q1_label">
          <label><input type="radio" name="QA_1" value="y"> YES</label><label><input type="radio" name="QA_1" value="n"> NO</label>
        </div>
      </div>`);
    await runAutofill(ctx({ willingToRelocate: 'yes' }), GENERIC_ADAPTER);
    const v = (n: string) => (document.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    expect([v('firstname'), v('lastname'), v('email'), v('city'), v('postcode'), v('country')]).toEqual(['Ana', 'García', 'ana@example.com', 'Berlin', '10115', 'Germany']);
    expect(v('summary')).toBe('Python engineer.');
    expect((document.querySelector('input[value="y"]') as HTMLInputElement).checked).toBe(true);
  });
});

describe('experience & education sections', () => {
  const twoJobs = () => {
    const c = ctx();
    c.profile.cv!.experience = [
      { job_title: 'Senior Python Developer', company: 'Acme GmbH', location: 'Berlin', dates: '03/2019 - Present', start: '03/2019', end: null, is_current: true, description: 'Built APIs\n- Cut latency 40%' },
      { job_title: 'Developer', company: 'Globex', location: 'Madrid', dates: '01/2016 - 02/2019', start: '01/2016', end: '02/2019', is_current: false, description: 'Web apps' },
    ];
    return c;
  };

  it('fills repeated experience blocks in order, dates per control type, current-role checkbox', async () => {
    mount(`
      <h2>Work Experience</h2>
      <div class="block">
        <label for="t1">Job title</label><input id="t1"><label for="c1">Company</label><input id="c1">
        <label for="s1">From</label><input id="s1" type="month"><label for="e1">To</label><input id="e1" type="month">
        <label><input type="checkbox" id="cur1"> I currently work here</label>
        <label for="d1">Description</label><textarea id="d1"></textarea>
      </div>
      <div class="block">
        <label for="t2">Job title</label><input id="t2"><label for="c2">Company</label><input id="c2">
        <label for="s2">From</label><input id="s2" placeholder="MM/YYYY"><label for="e2">To</label><input id="e2" placeholder="MM/YYYY">
        <label><input type="checkbox" id="cur2"> I currently work here</label>
      </div>`);
    await runAutofill(twoJobs(), GENERIC_ADAPTER);
    expect([value('#t1'), value('#c1'), value('#s1'), value('#e1')]).toEqual(['Senior Python Developer', 'Acme GmbH', '2019-03', '']);
    expect((document.querySelector('#cur1') as HTMLInputElement).checked).toBe(true);
    expect(value('#d1')).toContain('Cut latency 40%');
    expect([value('#t2'), value('#c2'), value('#s2'), value('#e2')]).toEqual(['Developer', 'Globex', '01/2016', '02/2019']);
    expect((document.querySelector('#cur2') as HTMLInputElement).checked).toBe(false);
  });

  it('fills education and month/year selects in any language', async () => {
    mount(`
      <fieldset><legend>Ausbildung</legend>
        <label for="u">Hochschule</label><input id="u"><label for="g">Abschluss</label><input id="g">
        <label for="f">Studienfach</label><input id="f">
        <label for="em">Ende Monat</label><select id="em"><option value="">--</option><option>Jan</option><option>Feb</option></select>
        <label for="ey">Ende Jahr</label><select id="ey"><option value="">--</option><option>2015</option><option>2016</option></select>
      </fieldset>`);
    const c = ctx();
    c.profile.cv!.education = [{ degree: 'BSc Computer Science', institution: 'TU Berlin', location: '', start: '10/2012', end: '02/2016', field_of_study: 'CS' }];
    await runAutofill(c, GENERIC_ADAPTER);
    expect([value('#u'), value('#g'), value('#f'), value('#em'), value('#ey')]).toEqual(['TU Berlin', 'BSc Computer Science', 'CS', 'Feb', '2016']);
  });

  it('prefers the tailored CV and outlines unreviewed tailored text for review', async () => {
    mount('<h3>Experience</h3><label for="t">Title</label><input id="t"><label for="d">Responsibilities</label><textarea id="d"></textarea>');
    const tailored = { ...ctx().profile.cv!, experience: [{ job_title: 'Backend Engineer', company: 'Acme', location: '', dates: '', start: null, end: null, is_current: true, description: 'Tailored wording for Globex' }] };
    const report = await runAutofill(twoJobs(), GENERIC_ADAPTER, document, { getTailoredCv: async () => ({ cv: tailored, reviewed: false }) });
    expect(value('#t')).toBe('Backend Engineer');
    expect(value('#d')).toBe('Tailored wording for Globex');
    expect((document.querySelector('#d') as HTMLElement).dataset.hustlenFill).toBe('review');
    expect(report.needsReview.length).toBeGreaterThan(0);
  });

  it('clicks the section "Add another" button when the CV has more entries than blocks', async () => {
    mount(`<section><h2>Work experience</h2><label for="t1">Job title</label><input id="t1"><label for="c1">Company</label><input id="c1">
      <button type="button" id="add">+ Add another work experience</button></section>
      <section><h2>Education</h2><button type="button" id="addEdu">Add education</button></section>`);
    const addClick = vi.fn();
    const eduClick = vi.fn();
    document.querySelector('#add')!.addEventListener('click', addClick);
    document.querySelector('#addEdu')!.addEventListener('click', eduClick);
    const report = await runAutofill(twoJobs(), GENERIC_ADAPTER);
    expect(addClick).toHaveBeenCalledTimes(1); // 2 jobs, 1 block -> open exactly one more
    expect(eduClick).not.toHaveBeenCalled(); // nothing filled in education -> don't add blocks there
    expect(report.sectionsAdded).toBe(1);
  });

  it('never adds blocks beyond the CV entries', async () => {
    mount(`<h2>Experience</h2><label for="t1">Job title</label><input id="t1"><label for="t2">Job title</label><input id="t2">
      <button type="button" id="add">Add experience</button>`);
    const addClick = vi.fn();
    document.querySelector('#add')!.addEventListener('click', addClick);
    await runAutofill(twoJobs(), GENERIC_ADAPTER);
    expect(addClick).not.toHaveBeenCalled();
    expect([value('#t1'), value('#t2')]).toEqual(['Senior Python Developer', 'Developer']);
  });
});

describe('section context boundaries', () => {
  it('ignores job-description headings outside the form', async () => {
    mount(`<article><h2>Experience you will bring</h2><p>5+ years</p></article>
      <form><label for="loc">Location</label><input id="loc"></form>`);
    await runAutofill(ctx(), GENERIC_ADAPTER);
    expect(value('#loc')).toBe('Berlin, Berlin, Germany'); // candidate location from profile, not a job entry
  });
});
