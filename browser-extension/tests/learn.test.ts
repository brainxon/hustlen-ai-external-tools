import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERIC_ADAPTER } from '@/lib/autofill/adapters';
import { runAutofill } from '@/lib/autofill/engine';
import { discoverFields } from '@/lib/autofill/fields';
import { captureAnswers, isLearnable, newToBank, saveToBank, stepOf } from '@/lib/autofill/learn';
import { classify } from '@/lib/autofill/matcher';
import { fieldFingerprint, findSavedAnswer, questionSimilarity, siteScope } from '@/lib/autofill/similarity';
import { EMPTY_ANSWER_BANK } from '@/lib/storage';
import { ctx, mount } from './fixtures';

const URL_ = 'https://boards.greenhouse.io/acme/jobs/1';

describe('question similarity', () => {
  it('matches rewordings, punctuation, accents and filler words', () => {
    expect(questionSimilarity('Why do you want to work at Acme?', 'Why would you like to work for Acme')).toBeGreaterThan(0.62);
    expect(questionSimilarity('¿Cuál es tu disponibilidad para empezar?', 'Disponibilidad para empezar')).toBeGreaterThan(0.62);
    expect(questionSimilarity('What are your salary expectations?', 'Describe your biggest failure')).toBeLessThan(0.3);
  });

  it('prefers an exact field fingerprint on the same company site', () => {
    const bank = { ...EMPTY_ANSWER_BANK, custom: [
      { question: 'Something else entirely', answer: 'exact', fp: 'boards.greenhouse.io/acme|question_555' },
      { question: 'Why Acme?', answer: 'fuzzy' },
    ] };
    expect(findSavedAnswer({ label: 'Why Acme?', fp: 'boards.greenhouse.io/acme|question_555' }, bank)?.answer).toBe('exact');
    expect(findSavedAnswer({ label: 'Why Acme?', fp: 'boards.greenhouse.io/globex|question_555' }, bank)?.answer).toBe('fuzzy');
  });

  it('never fingerprints indexed/generic names, and scopes by company', () => {
    expect(siteScope('https://boards.greenhouse.io/acme/jobs/1')).toBe('boards.greenhouse.io/acme');
    expect(fieldFingerprint('boards.greenhouse.io/acme', 'job_application[answers_attributes][0][text_value]')).toBeUndefined();
    expect(fieldFingerprint('x/y', 'field_3')).toBeUndefined();
    expect(fieldFingerprint('x/y', 'question_12345678')).toBe('x/y|question_12345678');
  });
});

describe('answer learning', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('never learns passwords, payment/ID data, profile contact data or protected characteristics', () => {
    mount(`<label for="p">Password</label><input id="p" type="password">
      <label for="i">IBAN</label><input id="i"><label for="n">Passport number</label><input id="n">
      <label for="e">Email</label><input id="e" type="email"><label for="g">Gender</label><select id="g"><option>F</option></select>
      <label for="w">Why do you want to join us?</label><textarea id="w"></textarea>`);
    const learnable = discoverFields().filter((f) => isLearnable(f, classify(f)?.key ?? null)).map((f) => f.label);
    expect(learnable).toEqual(['Why do you want to join us?']);
  });

  it('captures what the user typed or corrected, not what the extension filled untouched', async () => {
    mount(`<form>
      <label for="notice">What is your notice period?</label><input id="notice">
      <label for="why">Why do you want to join Acme?</label><textarea id="why"></textarea>
      <label for="auth">Are you legally authorized to work in Germany?</label><select id="auth"><option value="">--</option><option>Yes</option><option>No</option></select>
      <label for="s">Salary expectations</label><input id="s">
    </form>`);
    await runAutofill(ctx({ noticePeriod: '1 month', salaryExpectation: '65000' }), GENERIC_ADAPTER);
    (document.querySelector('#why') as HTMLTextAreaElement).value = 'I love your product.';
    (document.querySelector('#s') as HTMLInputElement).value = '70000'; // user corrected our fill
    (document.querySelector('#auth') as HTMLSelectElement).selectedIndex = 1;
    const got = captureAnswers(GENERIC_ADAPTER, document, URL_);
    const byQ = Object.fromEntries(got.map((c) => [c.question, c]));
    expect(byQ['What is your notice period?']).toBeUndefined(); // our fill, untouched
    expect(byQ['Why do you want to join Acme?']!.answer).toBe('I love your product.');
    expect(byQ['Salary expectations']).toMatchObject({ answer: '70000', bankField: 'salaryExpectation' });
    expect(byQ['Are you legally authorized to work in Germany?']).toMatchObject({ answer: 'Yes', bankField: 'workAuthorized' });
  });

  it('saves recurring questions into their field and the rest as custom answers; skips what the bank already knows', () => {
    const bank = { ...EMPTY_ANSWER_BANK, salaryExpectation: '65000', custom: [{ question: 'Why Acme?', answer: 'Old answer' }] };
    const base = { host: 'x', capturedAt: 1, kind: 'text' as const };
    const candidates = [
      { ...base, id: '1', question: 'Salary expectations', answer: '65000', bankField: 'salaryExpectation' },
      { ...base, id: '2', question: 'Are you authorized to work?', answer: 'Yes', bankField: 'workAuthorized' },
      { ...base, id: '3', question: 'Why Acme?', answer: 'New answer' },
      { ...base, id: '4', question: 'Favourite framework?', answer: 'FastAPI' },
    ];
    const fresh = newToBank(candidates, bank);
    expect(fresh.map((c) => c.id)).toEqual(['2', '3', '4']);
    const next = saveToBank(bank, fresh);
    expect(next.workAuthorized).toBe('yes');
    expect(next.custom.find((c) => c.question === 'Why Acme?')!.answer).toBe('New answer');
    expect(next.custom.map((c) => c.question)).toContain('Favourite framework?');
  });

  it('learned answers are filled on the next form', async () => {
    const bank = saveToBank(EMPTY_ANSWER_BANK, [{ id: '1', question: 'Why would you like to join Acme?', answer: 'Mission fit.', kind: 'textarea', host: 'x', capturedAt: 1 }]);
    mount('<label for="w">Why do you want to join Acme?</label><textarea id="w"></textarea>');
    const report = await runAutofill({ ...ctx(), answers: bank }, GENERIC_ADAPTER);
    expect((document.querySelector('#w') as HTMLTextAreaElement).value).toBe('Mission fit.');
    expect(report.fromAnswerBank).toBe(1);
  });

  it('detects submit and next-step buttons in several languages', () => {
    const btn = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild!;
    };
    expect(stepOf(btn('<button type="submit">Submit application</button>'))).toBe('submit');
    expect(stepOf(btn('<button>Bewerbung absenden</button>'))).toBe('submit');
    expect(stepOf(btn('<button>Enviar postulación</button>'))).toBe('submit');
    expect(stepOf(btn('<button data-automation-id="bottom-navigation-next-button">Save and Continue</button>'))).toBe('next');
    expect(stepOf(btn('<button>Siguiente</button>'))).toBe('next');
    expect(stepOf(btn('<button>Cancel</button>'))).toBeNull();
  });
});

describe('resume auto-attach', () => {
  it('attaches the provided CV to an empty resume upload field, lazily and once', async () => {
    const files: any[] = [];
    (globalThis as any).DataTransfer = class {
      items = { add: (f: File) => files.push(f) };
      get files() {
        return files;
      }
    };
    mount('<label for="cv">Upload your resume</label><input id="cv" type="file" accept=".pdf,.doc"><label for="cl">Cover letter upload</label><input id="cl" type="file">');
    const input = document.querySelector('#cv') as HTMLInputElement;
    let stored: any = null;
    Object.defineProperty(input, 'files', { get: () => stored, set: (v) => (stored = v), configurable: true });
    const getResumeFile = vi.fn(async () => ({ name: 'Ana_CV.pdf', type: 'application/pdf', base64: btoa('%PDF-1.7'), source: 'master' as const }));
    const report = await runAutofill(ctx(), GENERIC_ADAPTER, document, { getResumeFile });
    expect(getResumeFile).toHaveBeenCalledTimes(1);
    expect(stored?.[0]?.name).toBe('Ana_CV.pdf');
    expect(report.resume).toBe('master');
    delete (globalThis as any).DataTransfer;
  });
});
