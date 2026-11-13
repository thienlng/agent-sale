/**
 * Formatting and night arithmetic for the lodging screens. Nights are local calendar
 * dates 'YYYY-MM-DD'; the arithmetic runs in UTC so no browser time zone shifts a day.
 */
import type { TFunction } from 'i18next';

import { formatShortDate } from '@/lib/format';

export { formatVnd } from '@/lib/format';

const isEn = () => document.documentElement.lang === 'en';

/** Compact cell price: 12_000_000 → "12tr", 1_200_000 → "1,2tr", 850_000 → "850k" (vi). */
export function formatShortVnd(amount: number): string {
  const en = isEn();
  const fmt = (n: number) =>
    new Intl.NumberFormat(en ? 'en-US' : 'vi-VN', { maximumFractionDigits: 1 }).format(n);
  if (Math.abs(amount) >= 1_000_000) return `${fmt(amount / 1_000_000)}${en ? 'M' : 'tr'}`;
  if (Math.abs(amount) >= 1_000) return `${fmt(Math.round(amount / 1_000))}k`;
  return fmt(amount);
}

const toUtc = (night: string) =>
  Date.UTC(+night.slice(0, 4), +night.slice(5, 7) - 1, +night.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function addDays(night: string, days: number): string {
  return fromUtc(toUtc(night) + days * DAY);
}

/** Nights between check-in and check-out (check-out exclusive). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toUtc(checkOut) - toUtc(checkIn)) / DAY);
}

/** Every night from `from` (inclusive) to `to` (exclusive). */
export function nightList(from: string, to: string): string[] {
  const n = Math.max(0, nightsBetween(from, to));
  return Array.from({ length: n }, (_, i) => addDays(from, i));
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(night: string): number {
  const d = new Date(toUtc(night)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** "06/11" (inside a calendar whose year is already shown). */
export function dayMonth(night: string): string {
  return `${night.slice(8, 10)}/${night.slice(5, 7)}`;
}

/** A stay date in lists and dialogs: "06/11", or "06/01/2027" outside this year (VL-A8). */
export function stayDate(night: string, today: string = todayNight()): string {
  return formatShortDate(night, today);
}

export function weekdayShort(t: TFunction, night: string): string {
  return t(`weekdayShort.${isoWeekday(night)}`);
}

export function weekdayLong(t: TFunction, night: string): string {
  return t(`weekday.${isoWeekday(night)}`);
}

/** Today's night in the business time zone (check-in rules use Asia/Ho_Chi_Minh). */
export function todayNight(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
}

/** "14:30" in the business time zone. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** "06/11" of an instant in the business time zone (with the year outside this year). */
export function localDayMonth(iso: string, now: Date = new Date()): string {
  return stayDate(todayNight(new Date(iso)), todayNight(now));
}

/** Longest stay the API accepts. */
export const MAX_STAY_NIGHTS = 60;

/** True for a real range of 1–60 nights. */
export function isStayRange(checkIn: string, checkOut: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) return false;
  const n = nightsBetween(checkIn, checkOut);
  return n >= 1 && n <= MAX_STAY_NIGHTS;
}
