import { DEFAULT_HOSPITAL_TIMEZONE } from '@hospital/shared';

/** Datas sempre no fuso do hospital (America/Belem), independentemente do relógio do computador. */
const TZ = process.env.NEXT_PUBLIC_HOSPITAL_TIMEZONE ?? DEFAULT_HOSPITAL_TIMEZONE;

const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const longDateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

export const fmtTime = (iso: string | null | undefined): string => (iso ? timeFmt.format(new Date(iso)) : '—');
export const fmtDateTime = (iso: string | null | undefined): string => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const fmtLongDate = (d: Date = new Date()): string => longDateFmt.format(d);

/** "1974-04-12" → "12/04/1974" sem conversão de fuso (é uma data, não um instante). */
export const fmtDateOnly = (s: string | null | undefined): string => {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const fmtDate = (iso: string | null | undefined): string => (iso ? dateFmt.format(new Date(iso)) : '—');

export function fmtMinutes(min: number): string {
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

/** Médias: "< 1 min" em vez de "agora" (que só faz sentido para esperas em curso). */
export const fmtAvgMinutes = (min: number | null): string => (min === null ? '—' : min < 1 ? '< 1 min' : fmtMinutes(Math.round(min)));

export const minutesSince = (iso: string, now: number = Date.now()): number => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));

export const fmtPhone = (digits: string): string => {
  const d = digits.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
};
