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
