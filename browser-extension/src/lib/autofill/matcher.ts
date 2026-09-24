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
const BASE_RULES: [FieldKey, RegExp][] = [
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


/**
 * Unicode word-boundary builder: JS `\b` is ASCII-only, so it never matches
 * before/after accented letters ("État", "Éducation", "città"). `stem`
 * leaves the end open for inflections and compounds.
 */
export function w(alternatives: string, stem = false): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})${stem ? '' : '(?![\\p{L}\\p{N}])'}`, 'iu');
}

// French / Portuguese / Italian (plus a few es/de gaps), merged into the
// same key so priority order stays exactly as in BASE_RULES.
const EXTRA_RULES: Partial<Record<FieldKey, RegExp>> = {
  consent: w("j['’]accepte|consentement|politique de confidentialit|protection des donn|aceito|concordo|consentimento|pol[ií]tica de privacidade|prote[cç][aã]o de dados|accetto|acconsento|consenso|informativa (sulla )?privacy|trattamento dei dati", true),
  resume: w('(t[ée]l[ée]charger|joindre|importer|anexar|carregar|enviar|carica|allega)\\s.*(cv|curr[ií]cul)', true),
  cover_letter: w('lettre de motivation|carta de apresenta[cç][aã]o|carta de motiva[cç][aã]o|lettera (di presentazione|motivazionale)'),
  gender: w('genre|sexe|civilit[ée]|g[êe]nero|genere|sesso'),
  ethnicity: w('origine ethnique|ra[cç]a|origine etnica|etnia'),
  veteran: w('ancien combattant|veterano'),
  disability: w('handicap|defici[êe]ncia|disabilit[àa]|invalidit[àa]', true),
  sponsorship: w('parrainage|patroc[ií]nio|sponsorizzazione|visto|visa', true),
  work_authorization: w("autoris[ée]e? [àa] travailler|permis de travail|droit de travailler|autoriza[cç][aã]o de trabalho|autorizad[oa] a trabalhar|permiss[aã]o de trabalho|permesso di (lavoro|soggiorno)|autorizzat[oa] a lavorare"),
  relocate: w('d[ée]m[ée]nag|relocalis|mobilit[ée] g[ée]ographique|mudar-se|realoca|mudan[cç]a de cidade|trasferir|trasferiment|disponibilit[àa] a trasferirsi', true),
  remote: w('t[ée]l[ée]travail|[àa] distance|sur site|hybride|teletrabalho|h[ií]brido|remoto|da remoto|smart working|in sede|ibrido'),
  notice_period: w('pr[ée]avis|aviso pr[ée]vio|preavviso'),
  start_date: w("date de (d[ée]but|disponibilit[ée])|data de in[ií]cio|disponibilidade|data di inizio|disponibilit[àa]"),
  salary: w('salaire|r[ée]mun[ée]ration|pr[ée]tentions? salariales?|sal[áa]rio|pretens[aã]o salarial|remunera[cç][aã]o|stipendio|retribuzione|ral|aspettative economiche', true),
  years_experience: w("ann[ée]es d['’]exp[ée]rience|anos de experi[êe]ncia|anni di esperienza"),
  how_did_you_hear: w('comment avez-vous (connu|entendu)|como (soube|conheceu)|onde encontrou|come (hai saputo|ci hai conosciuto)|dove hai trovato', true),
  website: w('site (web|internet)|portf[óo]lio|sito web|site pessoal'),
  email: w('courriel|adresse e-?mail|correio eletr[ôo]nico|posta elettronica'),
  phone: w('t[ée]l[ée]phone|portable|telefone|celular|telem[óo]vel|telefono|cellulare', true),
  // Bare "Nome" (it/pt) = first name and bare "Nom" (fr) = last name, but only
  // when nothing follows ("Nom du poste", "Nome dell'azienda" are other fields).
  first_name: w("pr[ée]nom|primeiro nome|nome pr[óo]prio|nome(?!\\s*[\\p{L}'’])"),
  last_name: w("nom de famille|nom(?!\\s*[\\p{L}'’])|sobrenome|apelido|(?<!nome e )cognome"),
  full_name: w('nom complet|nome completo|nome e cognome'),
  zip: w('code postal|cep|c[óo]digo postal|cap|codice postale'),
  city: w('ville|localit[ée]|cidade|localidade|citt[àa]|comune|localit[àa]'),
  state: w('r[ée]gion|d[ée]partement|province|distrito|prov[ií]ncia|regione|provincia'),
  country: w('pays|pa[ií]s|paese|nazione'),
  location: w('localisation|lieu de r[ée]sidence|localiza[cç][aã]o|luogo di residenza'),
  address: w('adresse|rue|endere[cç]o|morada|rua|indirizzo'),
  current_company: w('employeur actuel|entreprise actuelle|empresa atual|empregador atual|azienda attuale|datore di lavoro attuale'),
  current_title: w('poste actuel|intitul[ée] du poste|cargo atual|ruolo attuale|posizione attuale'),
  school: w('[ée]cole|universit[ée]|[ée]tablissement|universidade|escola|institui[cç][aã]o|universit[àa]|scuola|istituto', true),
  degree: w('dipl[ôo]me|grau acad[êe]mico|diploma|titolo di studio|laurea'),
  field_of_study: w("domaine d['’][ée]tudes|sp[ée]cialit[ée]|[áa]rea de (estudo|forma[cç][aã]o)|corso di studi|indirizzo di studio"),
  graduation_year: w("ann[ée]e d['’]obtention|ano de conclus[aã]o|anno di (laurea|conseguimento)"),
  languages: w('langues|idiomas|l[íi]nguas|lingue'),
  summary: w('[àa] propos de vous|resumo|sobre voc[êe]|su di te'),
};

const RULES: [FieldKey, RegExp[]][] = BASE_RULES.map(([key, re]) => [key, EXTRA_RULES[key] ? [re, EXTRA_RULES[key]!] : [re]]);

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
  for (const [key, patterns] of RULES) {
    if (isLong && !['consent', 'sponsorship', 'work_authorization', 'relocate', 'salary', 'years_experience', 'notice_period', 'start_date', 'how_did_you_hear', 'gender', 'ethnicity', 'veteran', 'disability', 'remote', 'cover_letter'].includes(key)) continue;
    if (patterns.some((re) => re.test(label))) return { key, via: 'label' };
  }
  for (const [key, re] of HINTS) {
    if (re.test(field.hints)) return { key, via: 'hint' };
  }
  return null;
}
