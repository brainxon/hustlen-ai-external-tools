import type { EducationItem, ExperienceItem, FlatCv } from '../types';
import type { FieldDescriptor } from './fields';
import { normalize } from './fields';

/**
 * Work-experience and education sections, including repeatable
 * "Add another" blocks (Workday, Greenhouse, SmartRecruiters, Personio...).
 *
 * A field belongs to a section when its surroundings (headings, fieldset
 * legends, group labels, ATS attributes) say "experience" or "education";
 * its role (title/company/from/to...) comes from its own label; and its
 * entry number is the n-th occurrence of that role in the section, in DOM
 * order - so block 1 gets the CV's first entry, block 2 the second, etc.
 */

export type SectionKind = 'experience' | 'education';
export type SectionRole =
  | 'title' | 'company' | 'location' | 'start' | 'end' | 'current' | 'description'
  | 'school' | 'degree' | 'field';
export type DatePart = 'month' | 'year' | null;

export interface SectionSlot {
  kind: SectionKind;
  role: SectionRole;
  part: DatePart;
  index: number;
}

const EXP_CTX = /(work|professional|employment|job|career)\s*(experience|history)|\bexperience\b|employment|berufserfahrung|werdegang|berufliche|experiencia|trayectoria|expérience|workexperience|work_experience/i;
const EDU_CTX = /\beducation\b|academic|qualifications?|ausbildung|studium|bildung|educaci[oó]n|formaci[oó]n|estudios|formation|\beducation/i;

const ROLE_RULES: Record<SectionKind, [SectionRole, RegExp][]> = {
  experience: [
    ['current', /(currently|i) (work|am working) here|current (role|position|job)|present|to date|bis heute|derzeit|aktuell|actualmente|trabajo actual/i],
    ['title', /(job|position|role)\s*title|\btitle\b|position|\brole\b|jobtitel|berufsbezeichnung|puesto|cargo|poste/i],
    ['company', /company|employer|organi[sz]ation|firm|arbeitgeber|unternehmen|firma|empresa|entreprise/i],
    ['location', /location|city|\bort\b|standort|ubicaci[oó]n|ciudad|lieu/i],
    ['start', /\bfrom\b|start|begin|since|\bvon\b|beginn|desde|inicio|début/i],
    ['end', /\bto\b|\bend\b|end_?date|until|\bbis\b|\bende\b|hasta|\bfin\b/i],
    ['description', /description|responsibilit|summary|achievements|duties|tasks|beschreibung|aufgaben|descripci[oó]n|funciones|tareas/i],
  ],
  education: [
    ['end', /\bto\b|\bend\b|end_?date|\bende\b|until|graduat|completion|\bbis\b|abschlussjahr|hasta|finalizaci[oó]n/i],
    ['start', /\bfrom\b|start|begin|\bvon\b|\bbeginn\b|desde|inicio/i],
    ['school', /school|university|college|institution|institute|hochschule|universit|schule|universidad|instituci[oó]n|[ée]cole/i],
    ['degree', /degree|qualification|diploma|abschluss|titulaci[oó]n|t[ií]tulo|grado|dipl[oô]me/i],
    ['field', /field of study|major|discipline|subject|specializ|studienfach|studiengang|fachrichtung|carrera|especialidad|campo de estudio/i],
    ['location', /location|city|\bort\b|ubicaci[oó]n|ciudad/i],
    ['description', /description|activities|achievements|beschreibung|descripci[oó]n/i],
  ],
};

function headingTextNear(el: HTMLElement): string {
  const texts: string[] = [];
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
    const own = [node.getAttribute('aria-label'), node.getAttribute('data-automation-id'), node.id, String(node.getAttribute('class') || '')]
      .filter(Boolean)
      .join(' ');
    texts.push(own);
    // Stay inside the form/modal: headings of the job description above it
    // ("Experience you'll bring") must not turn candidate fields into a section.
    if (node.matches('form, [role="dialog"], dialog, body')) break;
    const legend = node.matches('fieldset') ? node.querySelector(':scope > legend') : null;
    if (legend) texts.push(legend.textContent || '');
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy && node !== el) texts.push(el.ownerDocument.getElementById(labelledBy)?.textContent || '');
    // Section heading: the closest preceding heading at this level.
    let sib = node.previousElementSibling as HTMLElement | null;
    for (let i = 0; sib && i < 6; i++, sib = sib.previousElementSibling as HTMLElement | null) {
      const h = sib.matches('h1,h2,h3,h4,h5,legend,[role="heading"]') ? sib : sib.querySelector('h1,h2,h3,h4,h5,[role="heading"]');
      if (h) {
        texts.push(h.textContent || '');
        break;
      }
    }
  }
  return normalize(texts.join(' | '));
}

export function sectionOf(field: FieldDescriptor): SectionKind | null {
  // ATS attributes first (Workday: workExperience-2--jobTitle, education-1--school).
  if (/workexperience|work_experience|employment/i.test(field.hints)) return 'experience';
  if (/education/i.test(field.hints)) return 'education';
  return sectionOfElement(field.element);
}

function datePart(field: FieldDescriptor): DatePart {
  const s = `${field.label} ${field.hints}`;
  // A full-date mask ("MM/YYYY", "YYYY-MM") is one control, not a month or year part.
  if (/mm\s*[/.-]\s*(yy)?yy|yyyy\s*[/.-]\s*mm/i.test(s)) return null;
  if (/month|monat|\bmes\b|mois|\bmm\b/i.test(s)) return 'month';
  if (/year|jahr|\baño\b|\bano\b|année|\byyyy\b/i.test(s)) return 'year';
  return null;
}

/** Maps every field that belongs to an experience/education section to its slot. */
export function assignSectionSlots(fields: FieldDescriptor[]): Map<string, SectionSlot> {
  const slots = new Map<string, SectionSlot>();
  const counters = new Map<string, number>();
  for (const f of fields) {
    if (f.kind === 'file') continue;
    const kind = sectionOf(f);
    if (!kind) continue;
    const text = `${f.label} ${f.hints}`;
    const rule = ROLE_RULES[kind].find(([role, re]) => (role !== 'current' || f.kind === 'checkbox') && re.test(text));
    if (!rule) continue;
    const role = rule[0];
    const part = role === 'start' || role === 'end' ? datePart(f) : null;
    const key = `${kind}:${role}:${part ?? ''}`;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    slots.set(f.id, { kind, role, part, index });
  }
  return slots;
}

// ---------------------------------------------------------------- values

const MONTHS: string[][] = [
  ['january', 'jan', 'enero', 'ene', 'januar', 'jän', 'janvier'],
  ['february', 'feb', 'febrero', 'februar', 'février', 'fév'],
  ['march', 'mar', 'marzo', 'märz', 'mars'],
  ['april', 'apr', 'abril', 'abr', 'avril', 'avr'],
  ['may', 'mayo', 'mai'],
  ['june', 'jun', 'junio', 'juni', 'juin'],
  ['july', 'jul', 'julio', 'juli', 'juillet'],
  ['august', 'aug', 'agosto', 'ago', 'août'],
  ['september', 'sep', 'sept', 'septiembre', 'setiembre'],
  ['october', 'oct', 'octubre', 'oktober', 'okt', 'octobre'],
  ['november', 'nov', 'noviembre', 'novembre'],
  ['december', 'dec', 'diciembre', 'dic', 'dezember', 'dez', 'décembre', 'déc'],
];

/** The select option that means month `m` (1-12): "03", "3", "Mar", "March", "Marzo", "März"... */
function monthOption(options: string[], m: number): string | null {
  const names = MONTHS[m - 1]!;
  for (const opt of options) {
    const o = normalize(opt).toLowerCase().replace(/\.$/, '');
    if (o === String(m) || o === String(m).padStart(2, '0') || names.includes(o) || names.some((n) => n.length > 3 && o.startsWith(n))) return opt;
  }
  return null;
}

export function parseCvDate(value: string | null | undefined): { year: number; month: number | null } | null {
  if (!value) return null;
  const my = value.match(/(\d{1,2})[./-](\d{4})/);
  if (my) return { month: Number(my[1]), year: Number(my[2]) };
  const ym = value.match(/(\d{4})[./-](\d{1,2})/);
  if (ym) return { year: Number(ym[1]), month: Number(ym[2]) };
  const y = value.match(/\d{4}/);
  return y ? { year: Number(y[0]), month: null } : null;
}

/** Formats a CV date for a specific control (type=month/date, MM/YYYY text, month/year parts). */
export function formatDateFor(field: FieldDescriptor, part: DatePart, raw: string | null): string | null {
  const d = parseCvDate(raw);
  if (!d) return null;
  const mm = String(d.month ?? 1).padStart(2, '0');
  if (part === 'year') return String(d.year);
  if (part === 'month') {
    if (!d.month) return null;
    if (field.kind === 'select') return monthOption(field.options, d.month);
    if (field.kind === 'combobox') return MONTHS[d.month - 1]![0]!.replace(/^./, (c) => c.toUpperCase());
    return mm;
  }
  const type = (field.element as HTMLInputElement).type;
  if (type === 'month') return `${d.year}-${mm}`;
  if (type === 'date') return `${d.year}-${mm}-01`;
  const hint = `${(field.element as HTMLInputElement).placeholder || ''} ${field.label}`;
  if (/yyyy[-/.]mm/i.test(hint)) return `${d.year}-${mm}`;
  return d.month ? `${mm}/${d.year}` : String(d.year);
}

export interface SectionValue {
  value: string;
  /** For the "I currently work here" checkbox. */
  check?: boolean;
}

export function sectionValue(slot: SectionSlot, field: FieldDescriptor, cv: FlatCv): SectionValue | null {
  if (slot.kind === 'experience') {
    const e: ExperienceItem | undefined = cv.experience[slot.index];
    if (!e) return null;
    switch (slot.role) {
      case 'title':
        return e.job_title ? { value: e.job_title } : null;
      case 'company':
        return e.company ? { value: e.company } : null;
      case 'location':
        return e.location ? { value: e.location } : null;
      case 'current':
        return { value: '', check: e.is_current };
      case 'start': {
        const v = formatDateFor(field, slot.part, e.start);
        return v ? { value: v } : null;
      }
      case 'end': {
        if (e.is_current) return null;
        const v = formatDateFor(field, slot.part, e.end);
        return v ? { value: v } : null;
      }
      case 'description':
        return e.description ? { value: e.description } : null;
      default:
        return null;
    }
  }
  const ed: EducationItem | undefined = cv.education[slot.index];
  if (!ed) return null;
  switch (slot.role) {
    case 'school':
      return ed.institution ? { value: ed.institution } : null;
    case 'degree':
      return ed.degree ? { value: ed.degree } : null;
    case 'field':
      return ed.field_of_study ? { value: ed.field_of_study } : null;
    case 'location':
      return ed.location ? { value: ed.location } : null;
    case 'start': {
      const v = formatDateFor(field, slot.part, ed.start);
      return v ? { value: v } : null;
    }
    case 'end': {
      const v = formatDateFor(field, slot.part, ed.end);
      return v ? { value: v } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- add another

const ADD_BUTTON: Record<SectionKind, RegExp> = {
  experience: /add( another| more| new)?\s*(work\s*)?(experience|position|job|employment|role)|weitere (berufserfahrung|position)|(agregar|añadir) (otra |más )?(experiencia|puesto)|ajouter.*exp[ée]rience/i,
  education: /add( another| more| new)?\s*(education|school|degree|qualification)|weitere ausbildung|(agregar|añadir) (otra |más )?(educaci[oó]n|formaci[oó]n|estudio)|ajouter.*formation/i,
};

/** The section's own "Add another" button, if the form has one. */
export function findAddButton(doc: Document, kind: SectionKind): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"], a'));
  return (
    candidates.find((b) => {
      const text = normalize(`${b.textContent} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-automation-id') || ''}`);
      if (ADD_BUTTON[kind].test(text)) return true;
      // Generic "Add" / "Add another" inside a section of this kind (Workday: "Add" under "Work Experience").
      return /^(\+\s*)?(add|add another|hinzufügen|agregar|añadir|ajouter)$/i.test(normalize(b.textContent)) && sectionOfElement(b) === kind;
    }) ?? null
  );
}

function sectionOfElement(el: HTMLElement): SectionKind | null {
  const ctx = headingTextNear(el);
  const exp = ctx.search(EXP_CTX);
  const edu = ctx.search(EDU_CTX);
  if (exp >= 0 && (edu < 0 || exp < edu)) return 'experience';
  return edu >= 0 ? 'education' : null;
}

export const MAX_SECTION_ENTRIES = 5;
