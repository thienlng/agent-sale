/**
 * The owner's clock (AS-3, AS-4). Owners live in Asia/Ho_Chi_Minh (UTC+7, no daylight saving),
 * but the API answers with UTC instants (`2026-11-12T20:05:39.000Z`), and a model reads that as
 * 20:05 on the 12th. Every instant the assistant sees is rewritten to the same instant written
 * with the +07:00 offset (`2026-11-13T03:05:39+07:00`); the instants the model writes back are
 * turned into UTC again before a route validates them. Pure.
 */

/** Asia/Ho_Chi_Minh is UTC+7 all year. */
const OFFSET_MS = 7 * 60 * 60 * 1000;
const OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A UTC instant as the API writes it: `…Z` or `…+00:00`, seconds and fraction optional. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]00:?00)$/;
/** Any instant with an explicit offset. */
const OFFSET_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** `YYYY-MM-DDTHH:mm:ss` of the instant on the owner's clock (no offset). */
function wallClock(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 19);
}

/** `2026-11-12T20:05:39.000Z` → `2026-11-13T03:05:39+07:00`; other text is returned as is. */
export function toLocalInstant(text: string): string {
  if (!UTC_INSTANT.test(text)) return text;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? text : `${wallClock(ms)}${OFFSET}`;
}

/** `2026-11-13T03:05:39+07:00` → `2026-11-13T03:05:39.000Z`; other text is returned as is. */
export function toUtcInstant(text: string): string {
  if (!OFFSET_INSTANT.test(text) || text.endsWith('Z')) return text;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? text : new Date(ms).toISOString();
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, mapStrings(v, fn)]),
    );
  }
  return value;
}

/** A UTC instant inside JSON text: a whole string value. */
const UTC_INSTANT_IN_JSON =
  /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]00:?00))"/g;

/**
 * Every UTC instant that is a whole JSON string value in a tool result, written on the owner's
 * clock (+07:00). Works on cut (`…[truncated]`) JSON too, since it never parses the text.
 */
export function localizeInstantsInJson(text: string): string {
  return text.replace(UTC_INSTANT_IN_JSON, (_, instant: string) => `"${toLocalInstant(instant)}"`);
}

/** Every instant with an offset in a JSON value, written in UTC (what the API schemas accept). */
export function utcInstants(value: unknown): unknown {
  return mapStrings(value, toUtcInstant);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The `<current_time>` text of a turn: the owner's date, weekday and time, then the calendar
 * ranges an owner's question names ("tuần này", "tuần sau", "tháng này"; weeks run Monday to
 * Sunday), so the model never works out a week boundary itself. Example:
 * `2026-11-13 01:49 Friday (Asia/Ho_Chi_Minh, +07:00); this week 2026-11-09..2026-11-15; next
 * week 2026-11-16..2026-11-22; this month 2026-11-01..2026-11-30`.
 */
export function describeNow(now: Date): string {
  const wall = now.getTime() + OFFSET_MS;
  const day = new Date(wall);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const monday = midnight - ((day.getUTCDay() + 6) % 7) * DAY_MS;
  const monthStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1);
  const monthEnd = Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1) - DAY_MS;
  const clock = new Date(wall).toISOString().slice(11, 16);
  return [
    `${ymd(midnight)} ${clock} ${WEEKDAYS[day.getUTCDay()]} (Asia/Ho_Chi_Minh, ${OFFSET})`,
    `this week ${ymd(monday)}..${ymd(monday + 6 * DAY_MS)}`,
    `next week ${ymd(monday + 7 * DAY_MS)}..${ymd(monday + 13 * DAY_MS)}`,
    `this month ${ymd(monthStart)}..${ymd(monthEnd)}`,
  ].join('; ');
}
