// Formatting helpers. Server and browser must produce the same text for the same input, or React
// hydration warns: always pass an explicit locale and time zone.
const LOCALE = 'es-CO';
const TIME_ZONE = 'America/Bogota';

const cop = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Money is integer cents (contracts/conventions.md): 18000000 cents -> "$ 180.000". */
export function formatCents(cents: number): string {
  return cop.format(cents / 100);
}

const dayTime = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const dayOnly = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeOnly = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

export const formatDateTime = (iso: string): string => dayTime.format(new Date(iso));
export const formatLongDate = (iso: string): string => dayOnly.format(new Date(iso));
export const formatTime = (iso: string): string => timeOnly.format(new Date(iso));

/** 187 -> "03:07". Never negative. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Whole seconds left until an ISO timestamp, never negative. */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}
