import { useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '@/lib/i18n';
import { answerBankStore, settingsStore, type AnswerBank, type Settings, DEFAULT_SETTINGS, EMPTY_ANSWER_BANK } from '@/lib/storage';

/**
 * The user's own answers to recurring screening questions. Stored locally
 * in the extension only; autofill uses them instantly, and protected
 * characteristics (gender, ethnicity, veteran, disability) are filled
 * ONLY from what the user picks here - never by AI.
 */

type YesNoKey = 'workAuthorized' | 'needsSponsorship' | 'willingToRelocate';
type TextKey = Exclude<keyof AnswerBank, YesNoKey | 'custom'>;

const YES_NO: [YesNoKey, MessageKey][] = [
  ['workAuthorized', 'Q_WORK_AUTH'],
  ['needsSponsorship', 'Q_SPONSORSHIP'],
  ['willingToRelocate', 'Q_RELOCATE'],
];

const TEXT: [TextKey, MessageKey, MessageKey | string][] = [
  ['salaryExpectation', 'F_SALARY', 'F_SALARY_PH'],
  ['noticePeriod', 'F_NOTICE', 'F_NOTICE_PH'],
  ['earliestStartDate', 'F_START', 'F_START_PH'],
  ['yearsOfExperience', 'F_YEARS', 'F_YEARS_PH'],
  ['remotePreference', 'F_REMOTE', 'F_REMOTE_PH'],
  ['howDidYouHear', 'F_HEAR', 'F_HEAR_PH'],
  ['website', 'F_WEBSITE', 'https://'],
  ['github', 'F_GITHUB', 'https://github.com/…'],
];

const EEO: [TextKey, MessageKey][] = [
  ['gender', 'F_GENDER'],
  ['ethnicity', 'F_ETHNICITY'],
  ['veteranStatus', 'F_VETERAN'],
  ['disabilityStatus', 'F_DISABILITY'],
];

const LANGUAGE_NAMES = { en: 'English', de: 'Deutsch', es: 'Español' } as const;

export function AnswerBankView() {
  const { t } = useT();
  const ph = (k: string) => (k.startsWith('F_') ? t(k as MessageKey) : k);
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
      <p class="lead small">{t('ANSWERS_LEAD')}</p>

      <section class="card">
        {YES_NO.map(([key, label]) => (
          <fieldset class="yesno" key={key}>
            <legend>{t(label)}</legend>
            {(['yes', 'no'] as const).map((v) => (
              <label key={v}>
                <input type="radio" name={key} checked={bank[key] === v} onChange={() => update({ [key]: v } as Partial<AnswerBank>)} />
                {v === 'yes' ? t('YES') : t('NO')}
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      <section class="card">
        {TEXT.map(([key, label, placeholder]) => (
          <label class="field" key={key}>
            <span>{t(label)}</span>
            <input value={bank[key] as string} placeholder={ph(placeholder)} onInput={(e) => update({ [key]: (e.target as HTMLInputElement).value } as Partial<AnswerBank>)} />
          </label>
        ))}
      </section>

      <section class="card">
        <h3>{t('EEO_TITLE')}</h3>
        <p class="fine">{t('EEO_HINT')}</p>
        {EEO.map(([key, label]) => (
          <label class="field" key={key}>
            <span>{t(label)}</span>
            <input value={bank[key] as string} placeholder={t('EEO_PH')} onInput={(e) => update({ [key]: (e.target as HTMLInputElement).value } as Partial<AnswerBank>)} />
          </label>
        ))}
      </section>

      <section class="card">
        <h3>{t('CUSTOM_TITLE')}</h3>
        <p class="fine">{t('CUSTOM_HINT')}</p>
        {bank.custom.map((c, i) => (
          <div class="custom" key={i}>
            <input value={c.question} placeholder={t('CUSTOM_Q_PH')} onInput={(e) => update({ custom: bank.custom.map((x, j) => (j === i ? { ...x, question: (e.target as HTMLInputElement).value } : x)) })} />
            <textarea value={c.answer} placeholder={t('CUSTOM_A_PH')} rows={2} onInput={(e) => update({ custom: bank.custom.map((x, j) => (j === i ? { ...x, answer: (e.target as HTMLTextAreaElement).value } : x)) })} />
            <button class="link danger" onClick={() => update({ custom: bank.custom.filter((_, j) => j !== i) })}>{t('REMOVE')}</button>
          </div>
        ))}
        <button class="btn" onClick={() => update({ custom: [...bank.custom, { question: '', answer: '' }] })}>{t('ADD_ANSWER')}</button>
      </section>

      <section class="card">
        <h3>{t('SETTINGS_TITLE')}</h3>
        <label class="toggle">
          <input type="checkbox" checked={settings.useAiForOpenQuestions} onChange={(e) => setSettings({ ...settings, useAiForOpenQuestions: (e.target as HTMLInputElement).checked })} />
          {t('SETTING_AI')}
        </label>
        <label class="toggle">
          <input type="checkbox" checked={settings.showInPageButton} onChange={(e) => setSettings({ ...settings, showInPageButton: (e.target as HTMLInputElement).checked })} />
          {t('SETTING_BUTTON')}
        </label>
        <label class="field">
          <span>{t('SETTING_LANGUAGE')}</span>
          <select
            value={settings.uiLanguage ?? 'auto'}
            onChange={async (e) => {
              const next = { ...settings, uiLanguage: (e.target as HTMLSelectElement).value as typeof settings.uiLanguage };
              setSettings(next);
              await settingsStore.setValue(next); // applies immediately, no need to press Save
            }}
          >
            <option value="auto">{t('LANGUAGE_AUTO')}</option>
            {(Object.keys(LANGUAGE_NAMES) as (keyof typeof LANGUAGE_NAMES)[]).map((l) => (
              <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>
            ))}
          </select>
        </label>
      </section>

      <div class="sticky-save">
        <button class="btn primary block" onClick={persist}>{saved ? t('ANSWERS_SAVED') : t('SAVE_ANSWERS')}</button>
      </div>
    </main>
  );
}
