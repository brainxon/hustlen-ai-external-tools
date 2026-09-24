import type { FieldDescriptor } from './fields';

/**
 * Classifies a form field into a known profile key using the
 * `autocomplete` attribute first (most reliable), then multi-language
 * label/attribute patterns (en/de/es/fr/pt). Anything unclassified is a
 * candidate screening question.
 */

export type FieldKey =
  | 'first_name' | 'last_name' | 'middle_name' | 'full_name' | 'preferred_name'
  | 'email' | 'phone' | 'phone_country'
  | 'address' | 'city' | 'state' | 'zip' | 'country' | 'location'
  | 'linkedin' | 'website' | 'github' | 'twitter'
  | 'current_company' | 'current_title' | 'headline' | 'summary'
  | 'years_experience' | 'salary' | 'notice_period' | 'start_date'
  | 'work_authorization' | 'sponsorship' | 'relocate' | 'remote'
  | 'how_did_you_hear'
  | 'school' | 'degree' | 'field_of_study' | 'graduation_year'
  | 'languages' | 'skills'
  | 'gender' | 'ethnicity' | 'veteran' | 'disability'
  | 'resume' | 'cover_letter' | 'consent';

export interface Classification {
  key: FieldKey;
  /** 'autocomplete' and 'hint' matches are safer than a free-text label match. */
  via: 'autocomplete' | 'adapter' | 'label' | 'hint';
}

const AUTOCOMPLETE: Record<string, FieldKey> = {
  'given-name': 'first_name',
  'family-name': 'last_name',
  'additional-name': 'middle_name',
  name: 'full_name',
  nickname: 'preferred_name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'tel-country-code': 'phone_country',
  'street-address': 'address',
  'address-line1': 'address',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'zip',
  country: 'country',
  'country-name': 'country',
  organization: 'current_company',
  'organization-title': 'current_title',
  url: 'website',
};

// Order matters: the first matching rule wins, so specific rules come
// before generic ones (e.g. "last name" before "name", "LinkedIn" before
// "website", EEO questions before anything that might contain "status").
const RULES: [FieldKey, RegExp][] = [
  // Stem rules (relocat…, sponsor…, datenschutz…) have no trailing \b so they
  // match every inflection and German compound.
  ['consent', /\b(i (agree|consent|accept|acknowledge|certify)|privacy (policy|notice)|terms (and|&) conditions|datenschutz|einwillig|acepto|consentimiento|política de privacidad)/i],
  ['resume', /\b(resume|résumé|cv\b|curriculum|lebenslauf)\b.*\b(upload|attach|file|datei|adjunt|subir)|\b(upload|attach|anhängen|adjuntar|subir)\b.*\b(resume|cv|lebenslauf|curr[ií]culum)/i],
  ['cover_letter', /\b(cover ?letter|anschreiben|motivationsschreiben|carta de presentaci[oó]n|lettre de motivation)\b/i],
  ['gender', /\b(gender|sex\b|pronoun|geschlecht|anrede|g[eé]nero|sexo)\b/i],
  ['ethnicity', /\b(race\b|racial|ethnic|hispanic|latin[oax]|herkunft|etnia|raza\b)/i],
  ['veteran', /\b(veteran|military service|protected veteran)\b/i],
  ['disability', /\b(disabilit|handicap|behinderung|schwerbehinder|discapacidad)|behinderung/i],
  ['sponsorship', /\b(sponsor|visa\b|h-?1b|arbeitserlaubnis.*(benötig|sponsor)|patrocin)/i],
  ['work_authorization', /\b(authori[sz]ed to work|legally (authori[sz]ed|eligible|allowed)|right to work|work authori[sz]ation|eligible to work|arbeitserlaubnis|arbeitsgenehmigung|autorizaci[oó]n (para|de) trabajo|permiso de trabajo)\b/i],
  ['relocate', /\b(relocat|umzug|umzieh|reubica|mudar(te|se)|traslad)/i],
  ['remote', /\b(remote|hybrid|on-?site|work(ing)? (arrangement|model|location preference)|homeoffice|home office|remoto|teletrabajo|presencial)\b/i],
  ['notice_period', /\b(notice period|kündigungsfrist|preaviso|per[ií]odo de aviso)\b/i],
  ['start_date', /\b(start date|earliest (start|available)|availability|available (from|to start)|eintrittsdatum|frühester eintritt|verfügbar ab|fecha de (inicio|incorporaci[oó]n)|disponibilidad)\b/i],
  ['salary', /\b(salary|compensation|pay expectation|desired pay|gehalt|salario|sueldo|pretensi[oó]n|remuneraci[oó]n|expected ctc)/i],
  ['years_experience', /\b(years? of (relevant |professional |work )?experience|how many years|jahre(n)? (berufs)?erfahrung|años de experiencia)\b/i],
  ['how_did_you_hear', /\b(how did you (hear|find|learn)|where did you (hear|find|see)|referral source|source of application|wie (sind sie|hast du).*(aufmerksam|erfahren)|c[oó]mo (te enteraste|nos conociste|supiste))\b/i],
  ['linkedin', /linkedin/i],
  ['github', /\bgithub\b/i],
  ['twitter', /\b(twitter|x\.com)\b/i],
  ['website', /\b(website|portfolio|personal (site|url|page)|homepage|webseite|sitio web|p[aá]gina web)\b/i],
  ['email', /\b(e-?mail|correo)\b/i],
  ['phone_country', /\b(country code|phone code|dial(ing)? code|vorwahl|ländervorwahl|c[oó]digo (de )?pa[ií]s)\b/i],
  // German compounds (Telefonnummer, Handynummer, Mobilnummer): no trailing boundary on those stems.
  ['phone', /\b(phone|mobile|cell|telephone|tel[eé]fono|celular|m[oó]vil)\b|\b(telefon|handy|mobil)/i],
  ['preferred_name', /\b(preferred (first )?name|nickname|rufname|nombre preferido)\b/i],
  ['middle_name', /\b(middle name|zweiter vorname|segundo nombre)\b/i],
  ['first_name', /\b(first ?name|given ?name|forename|vorname|nombre(?! (completo|de (la )?empresa|preferido))|pr[eé]nom)\b|^name \(first\)|legalname.*first|first_name|firstname|fname/i],
  ['last_name', /\b(last ?name|surname|family ?name|nachname|familienname|apellidos?|nom de famille)\b|legalname.*last|last_name|lastname|lname/i],
  ['full_name', /^(full |your |legal )?name$|\b(full name|your name|vollständiger name|nombre completo|nom complet)\b/i],
  ['zip', /\b(zip|postal ?code|post ?code|postleitzahl|plz|c[oó]digo postal)\b/i],
  ['city', /\b(city|town|stadt|ort\b|wohnort|ciudad|localidad|ville)\b/i],
  ['state', /\b(state|province|region|bundesland|provincia|estado|departamento)\b/i],
  ['country', /\b(country|land\b|pa[ií]s|pays)\b/i],
  ['location', /\b(location|current location|where are you (based|located)|standort|ubicaci[oó]n|lugar de residencia)\b/i],
  ['address', /\b(address|street|straße|strasse|anschrift|direcci[oó]n|calle)\b/i],
  ['current_company', /\b(current (company|employer)|present employer|most recent (company|employer)|aktueller arbeitgeber|empresa actual|employer)\b/i],
  ['current_title', /\b(current (job )?(title|position|role)|job title|present title|aktuelle position|jobtitel|cargo actual|puesto actual)\b/i],
  ['headline', /\b(headline|professional title)\b/i],
  ['school', /\b(school|university|college|institution|hochschule|universität|universidad|instituci[oó]n)\b/i],
  ['degree', /\b(degree|qualification|abschluss|titulaci[oó]n|t[ií]tulo)\b/i],
  ['field_of_study', /\b(field of study|major|discipline|studienfach|studiengang|carrera|especialidad)\b/i],
  ['graduation_year', /\b(graduation (year|date)|year of graduation|abschlussjahr|año de graduaci[oó]n)\b/i],
  ['languages', /\b(languages? (spoken|you speak)|language skills|sprachkenntnisse|idiomas)\b/i],
  ['skills', /^(skills|key skills|kenntnisse|habilidades)$/i],
  ['summary', /\b(summary|about (you|yourself)|profile summary|kurzprofil|resumen profesional|sobre ti)\b/i],
];

// Attribute hints (name/id/automation ids) that are unambiguous on their own.
const HINTS: [FieldKey, RegExp][] = [
  ['first_name', /(^|[_\-. ])(first_?name|firstname|given_?name|fname)([_\-. ]|$)/],
  ['last_name', /(^|[_\-. ])(last_?name|lastname|family_?name|surname|lname)([_\-. ]|$)/],
  ['email', /(^|[_\-. ])e?-?mail([_\-. ]|$)/],
  ['phone', /(^|[_\-. ])(phone|mobile|tel)([_\-. ]|number|$)/],
  ['linkedin', /linkedin/],
  ['github', /github/],
  ['zip', /(zip|postal|post_?code|postleitzahl|\bplz\b)/],
  ['city', /(^|[_\-. ])(city|town)([_\-. ]|$)/],
  ['country', /(^|[_\-. ])country([_\-. ]|$)/],
  ['state', /(^|[_\-. ])(state|province|region)([_\-. ]|$)/],
  ['address', /(^|[_\-. ])(address|street)(_?line_?1)?([_\-. ]|$)/],
  ['headline', /(^|[_\-. ])headline([_\-. ]|$)/],
  ['summary', /(^|[_\-. ])summary([_\-. ]|$)/],
  ['cover_letter', /cover_?letter/],
];

export function classify(field: FieldDescriptor, adapterHint?: FieldKey | null): Classification | null {
  if (adapterHint) return { key: adapterHint, via: 'adapter' };

  const ac = field.autocomplete.split(/\s+/).pop() || '';
  if (ac && ac !== 'off' && ac !== 'on' && AUTOCOMPLETE[ac]) {
    return { key: AUTOCOMPLETE[ac], via: 'autocomplete' };
  }
  if (field.kind === 'email') return { key: 'email', via: 'hint' };
  if (field.kind === 'tel') return { key: 'phone', via: 'hint' };
  if (field.kind === 'file') {
    return /cover|anschreiben|carta/i.test(field.label + field.hints) ? { key: 'cover_letter', via: 'hint' } : { key: 'resume', via: 'hint' };
  }

  const label = field.label;
  // Long labels are questions ("Describe a project where you used Python…");
  // only match the specific keys against them, never generic ones like "name".
  const isLong = label.length > 90;
  for (const [key, re] of RULES) {
    if (isLong && !['consent', 'sponsorship', 'work_authorization', 'relocate', 'salary', 'years_experience', 'notice_period', 'start_date', 'how_did_you_hear', 'gender', 'ethnicity', 'veteran', 'disability', 'remote', 'cover_letter'].includes(key)) continue;
    if (re.test(label)) return { key, via: 'label' };
  }
  for (const [key, re] of HINTS) {
    if (re.test(field.hints)) return { key, via: 'hint' };
  }
  return null;
}
