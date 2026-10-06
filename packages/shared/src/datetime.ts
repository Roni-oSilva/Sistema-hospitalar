/**
 * Datas no fuso do hospital. O banco guarda tudo em UTC (timestamptz); o "dia" do hospital (contadores diários,
 * dashboard "hoje", ano do ATD) é sempre calculado no fuso configurado — padrão America/Belem (UTC−3, Ulianópolis/PA).
 */

export const DEFAULT_HOSPITAL_TIMEZONE = 'America/Belem';

/** "YYYY-MM-DD" do instante no fuso informado. */
export function localDateString(date: Date, timeZone: string = DEFAULT_HOSPITAL_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localYear(date: Date, timeZone: string = DEFAULT_HOSPITAL_TIMEZONE): number {
  return Number(localDateString(date, timeZone).slice(0, 4));
}

/** Deslocamento (em minutos, positivo a leste de UTC) do fuso no instante dado. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Intervalo [início, fim) em UTC do dia local "YYYY-MM-DD" no fuso informado. */
export function dayRange(dateStr: string, timeZone: string = DEFAULT_HOSPITAL_TIMEZONE): { start: Date; end: Date } {
  const toInstant = (d: string): Date => {
    const guess = new Date(`${d}T00:00:00Z`);
    let instant = new Date(guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60000);
    // segunda passada corrige o caso de o deslocamento mudar entre o palpite e o instante real
    instant = new Date(guess.getTime() - tzOffsetMinutes(instant, timeZone) * 60000);
    return instant;
  };
  const next = new Date(`${dateStr}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: toInstant(dateStr), end: toInstant(next.toISOString().slice(0, 10)) };
}

export interface AgeParts {
  years: number;
  months: number;
  days: number;
}

/** Idade na data de referência. `birthDate` = "YYYY-MM-DD". */
export function calcAge(birthDate: string, ref: Date = new Date(), timeZone: string = DEFAULT_HOSPITAL_TIMEZONE): AgeParts {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [ry, rm, rd] = localDateString(ref, timeZone).split('-').map(Number);
  let years = ry - by;
  let months = rm - bm;
  let days = rd - bd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ry, rm - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

export function formatAge(age: AgeParts): string {
  if (age.years >= 2) return `${age.years} anos`;
  if (age.years === 1) return age.months > 0 ? `1 ano e ${age.months} ${age.months === 1 ? 'mês' : 'meses'}` : '1 ano';
  if (age.months >= 1) return `${age.months} ${age.months === 1 ? 'mês' : 'meses'}`;
  return `${age.days} ${age.days === 1 ? 'dia' : 'dias'}`;
}

export function ageLabel(birthDate: string, ref: Date = new Date(), timeZone?: string): string {
  return formatAge(calcAge(birthDate, ref, timeZone));
}

export function minutesBetween(from: Date | string, to: Date | string = new Date()): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000));
}
