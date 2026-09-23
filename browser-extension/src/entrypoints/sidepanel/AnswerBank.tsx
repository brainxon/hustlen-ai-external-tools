import { useEffect, useState } from 'preact/hooks';
import { answerBankStore, settingsStore, type AnswerBank, type Settings, DEFAULT_SETTINGS, EMPTY_ANSWER_BANK } from '@/lib/storage';

/**
 * The user's own answers to recurring screening questions. Stored locally
 * in the extension only; autofill uses them instantly, and protected
 * characteristics (gender, ethnicity, veteran, disability) are filled
 * ONLY from what the user picks here - never by AI.
 */

type YesNoKey = 'workAuthorized' | 'needsSponsorship' | 'willingToRelocate';
type TextKey = Exclude<keyof AnswerBank, YesNoKey | 'custom'>;

const YES_NO: [YesNoKey, string][] = [
  ['workAuthorized', 'Are you legally authorized to work in the job’s country?'],
  ['needsSponsorship', 'Will you now or in the future require visa sponsorship?'],
  ['willingToRelocate', 'Are you willing to relocate?'],
];

const TEXT: [TextKey, string, string][] = [
  ['salaryExpectation', 'Salary expectation', 'e.g. 65000 EUR'],
  ['noticePeriod', 'Notice period', 'e.g. 1 month'],
  ['earliestStartDate', 'Earliest start date', 'YYYY-MM-DD'],
  ['yearsOfExperience', 'Years of experience', 'e.g. 6'],
  ['remotePreference', 'Work arrangement', 'Remote / Hybrid / On-site'],
  ['howDidYouHear', 'How did you hear about us?', 'e.g. LinkedIn'],
  ['website', 'Website / portfolio', 'https://'],
  ['github', 'GitHub', 'https://github.com/…'],
];

const EEO: [TextKey, string][] = [
  ['gender', 'Gender'],
  ['ethnicity', 'Race / ethnicity'],
  ['veteranStatus', 'Veteran status'],
  ['disabilityStatus', 'Disability status'],
];

export function AnswerBankView() {
  const [bank, setBank] = useState<AnswerBank>(EMPTY_ANSWER_BANK);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    answerBankStore.getValue().then((b) => setBank({ ...EMPTY_ANSWER_BANK, ...b }));
    settingsStore.getValue().then((s) => setSettings({ ...DEFAULT_SETTINGS, ...s }));
  }, []);

  const update = (patch: Partial<AnswerBank>) => {
    setBank((b) => ({ ...b, ...patch }));
    setSaved(false);
  };

  const persist = async () => {
    await answerBankStore.setValue({ ...bank, custom: bank.custom.filter((c) => c.question.trim() && c.answer.trim()) });
    await settingsStore.setValue(settings);
    setSaved(true);
  };

  return (
    <main class="stack answers">
      <p class="lead small">Answer these once. Autofill reuses them instantly on every application.</p>

      <section class="card">
        {YES_NO.map(([key, label]) => (
          <fieldset class="yesno" key={key}>
            <legend>{label}</legend>
            {(['yes', 'no'] as const).map((v) => (
              <label key={v}>
                <input type="radio" name={key} checked={bank[key] === v} onChange={() => update({ [key]: v } as Partial<AnswerBank>)} />
                {v === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      <section class="card">
        {TEXT.map(([key, label, placeholder]) => (
          <label class="field" key={key}>
            <span>{label}</span>
            <input value={bank[key] as string} placeholder={placeholder} onInput={(e) => update({ [key]: (e.target as HTMLInputElement).value } as Partial<AnswerBank>)} />
          </label>
        ))}
      </section>

      <section class="card">
        <h3>Voluntary self-identification</h3>
        <p class="fine">Optional. Only used if you fill it in here. AI never answers these for you.</p>
        {EEO.map(([key, label]) => (
          <label class="field" key={key}>
            <span>{label}</span>
            <input value={bank[key] as string} placeholder="e.g. Prefer not to say" onInput={(e) => update({ [key]: (e.target as HTMLInputElement).value } as Partial<AnswerBank>)} />
          </label>
        ))}
      </section>

      <section class="card">
        <h3>Custom answers</h3>
        <p class="fine">Reused whenever a form asks a similar question.</p>
        {bank.custom.map((c, i) => (
          <div class="custom" key={i}>
            <input value={c.question} placeholder="Question" onInput={(e) => update({ custom: bank.custom.map((x, j) => (j === i ? { ...x, question: (e.target as HTMLInputElement).value } : x)) })} />
            <textarea value={c.answer} placeholder="Your answer" rows={2} onInput={(e) => update({ custom: bank.custom.map((x, j) => (j === i ? { ...x, answer: (e.target as HTMLTextAreaElement).value } : x)) })} />
            <button class="link danger" onClick={() => update({ custom: bank.custom.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button class="btn" onClick={() => update({ custom: [...bank.custom, { question: '', answer: '' }] })}>+ Add answer</button>
      </section>

      <section class="card">
        <h3>Settings</h3>
        <label class="toggle">
          <input type="checkbox" checked={settings.useAiForOpenQuestions} onChange={(e) => setSettings({ ...settings, useAiForOpenQuestions: (e.target as HTMLInputElement).checked })} />
          Draft open questions with AI from my CV
        </label>
        <label class="toggle">
          <input type="checkbox" checked={settings.showInPageButton} onChange={(e) => setSettings({ ...settings, showInPageButton: (e.target as HTMLInputElement).checked })} />
          Show the Autofill button on application pages
        </label>
      </section>

      <div class="sticky-save">
        <button class="btn primary block" onClick={persist}>{saved ? '✓ Saved' : 'Save answers'}</button>
      </div>
    </main>
  );
}
