import type {
  CustomerRequestKind,
  RequestProfile,
  RequestStatusMove,
} from '@agent-sales/contracts';
import { foldVietnamese, vietnameseDateLabel } from '@agent-sales/shared';

/**
 * Pure rules of a bot-recorded customer request (ESV spec §5.1; ADR-020 generalised): the note
 * staff read, the status move, the server-computed day label and the past-date check.
 */

/** Signature of the notes the bot leaves on a customer. */
export const BOT_AUTHOR = 'Bot AI';

/** A second request of the same kind within this window updates the first. */
export const UPDATE_WINDOW_MS = 24 * 3_600_000;

/** The business time zone of every request industry today (Vietnam). */
const REQUEST_TIME_ZONE_OFFSET_MS = 7 * 3_600_000;

/**
 * "Thứ Bảy 07/11/2026" for `2026-11-07`; null for a value that is not a YYYY-MM-DD date. The
 * shared helper keeps the spelling identical to lodging and the eval writer.
 */
export const dateLabel = vietnameseDateLabel;

/** Today's calendar date in Asia/Ho_Chi_Minh (UTC+7, no daylight saving). */
export function localToday(now: Date): string {
  return new Date(now.getTime() + REQUEST_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);
}

/** The last second of `now`'s day in Asia/Ho_Chi_Minh. */
export function endOfLocalDay(now: Date): Date {
  const day = localToday(now);
  return new Date(Date.parse(`${day}T23:59:59Z`) - REQUEST_TIME_ZONE_OFFSET_MS);
}

/**
 * The hour a customer's time wish names, 24 h ("9h", "9h30", "14:00", "4h chiều", "tối 7h",
 * "around 3pm"); null when it names none ("buổi sáng", "cuối tuần").
 */
export function slotTime(text: string): { hour: number; minute: number } | null {
  const t = foldVietnamese(text).toLowerCase();
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
  const viet = /\b(\d{1,2})\s*(?:h|gio|:)\s*(\d{2})?/.exec(t);
  const m = ampm ?? viet;
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const afternoon = ampm ? ampm[3] === 'pm' : /\b(chieu|toi|pm)\b/.test(t);
  if (afternoon && hour < 12) hour += 12;
  if (ampm && ampm[3] === 'am' && hour === 12) hour = 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** When the staff task of a date-only wish falls due: that morning, before the shop opens. */
const DATE_ONLY_HOUR = 8;

/**
 * When the staff task of a request falls due (LM2-8): the slot the customer asked for (its
 * day, and its hour when the time names one, else 08:00), in Asia/Ho_Chi_Minh; the end of today
 * without a day, or when that moment has already passed. Never "overdue" at creation.
 */
export function requestDueAt(details: Readonly<Record<string, unknown>>, now: Date): Date {
  const endOfToday = endOfLocalDay(now);
  const words = typeof details['preferredTime'] === 'string' ? details['preferredTime'] : '';
  const given = typeof details['preferredDate'] === 'string' ? details['preferredDate'] : '';
  // Without a date the time words may still name the day ("sau 9h tối thứ 3").
  const date = /^\d{4}-\d{2}-\d{2}$/.test(given) ? given : (dayFromWords(words, now) ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return endOfToday;
  const time =
    typeof details['preferredTime'] === 'string' ? slotTime(details['preferredTime']) : null;
  const hh = String(time?.hour ?? DATE_ONLY_HOUR).padStart(2, '0');
  const mm = String(time?.minute ?? 0).padStart(2, '0');
  const at = new Date(Date.parse(`${date}T${hh}:${mm}:00Z`) - REQUEST_TIME_ZONE_OFFSET_MS);
  return Number.isNaN(at.getTime()) || at.getTime() <= now.getTime() ? endOfToday : at;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  '2': 1,
  hai: 1,
  '3': 2,
  ba: 2,
  '4': 3,
  tu: 3,
  '5': 4,
  nam: 4,
  '6': 5,
  sau: 5,
  '7': 6,
  bay: 6,
};

/**
 * The local date (YYYY-MM-DD) the customer's time words name, from today on: "hôm nay", "mai" /
 * "ngày mai", a weekday ("thứ 3", "thứ ba", "chủ nhật", "CN": the next one, today included) or
 * "17/11". Null when they name none.
 */
export function dayFromWords(text: string, now: Date): string | null {
  const t = foldVietnamese(text).toLowerCase();
  const today = localToday(now);
  const plus = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(t);
  if (dm) {
    const year = Number(dm[3] ?? today.slice(0, 4));
    const iso = `${year}-${dm[2]!.padStart(2, '0')}-${dm[1]!.padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return null;
    // "17/11" without a year in the past means next year.
    return !dm[3] && iso < today ? `${year + 1}${iso.slice(4)}` : iso;
  }
  if (/\bhom nay\b|\btoi nay\b|\bchieu nay\b|\bsang nay\b/.test(t)) return today;
  if (/\b(ngay )?mai\b/.test(t) && !/\bmai\s*(lan|anh)\b/.test(t)) return plus(1);
  const weekday = /\b(?:thu\s*(2|3|4|5|6|7|hai|ba|tu|nam|sau|bay)\b|(chu\s*nhat|cn)\b)/.exec(t);
  if (!weekday) return null;
  const target = weekday[2] ? 0 : (WEEKDAYS[weekday[1]!] ?? null);
  if (target === null) return null;
  const current = new Date(`${today}T00:00:00Z`).getUTCDay();
  return plus((target - current + 7) % 7);
}

/** The first line of a bot request note without its "Cập nhật: " prefix: which request it is. */
export function requestNoteHead(body: string): string {
  return (body.split('\n')[0] ?? '').replace(/^Cập nhật: /, '');
}

/** True when the date is before today in Asia/Ho_Chi_Minh (today itself is not past). */
export function isPastDate(yyyyMmDd: string, now: Date): boolean {
  return yyyyMmDd < localToday(now);
}

/**
 * The note the bot leaves on the customer: what was asked and what the customer said, one line per
 * given detail in the profile's field order. `phone` has no line (it identifies the customer); a
 * `preferredDate` is written as its day label. Staff read it in Vietnamese (business content). The
 * saas text is byte-identical to the ADR-020 `leadNote`.
 */
export function requestNote(
  profile: RequestProfile,
  kind: CustomerRequestKind,
  details: Readonly<Record<string, unknown>>,
  update: boolean,
): string {
  const head = `${profile.kindLabels[kind] ?? kind} (bot ghi nhận)`;
  const lines: string[] = [update ? `Cập nhật: ${head}` : head];
  for (const field of profile.fields) {
    if (field.key === 'phone') continue;
    const value = details[field.key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const shown = field.key === 'preferredDate' ? (dateLabel(value) ?? value) : value;
    lines.push(`${field.label}: ${shown}`);
  }
  return lines.join('\n');
}

/**
 * The details kept in the history entry: every given field except `phone` and `email` (contact
 * data stays on the customer), empty ones dropped, in the profile's field order.
 */
export function historyDetails(
  profile: RequestProfile,
  details: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of profile.fields) {
    if (field.key === 'phone' || field.key === 'email') continue;
    const value = details[field.key];
    if (typeof value === 'string' && value.trim()) out[field.key] = value;
  }
  return out;
}

/** The day fields: an update that names one replaces both (a new day drops the old time). */
const WHEN_FIELDS = ['preferredDate', 'preferredTime'] as const;

/**
 * The details of an update (QA retest M5): the previous request's stored details (`data.details`
 * of its history entry), with every non-empty new value over them. A new conversation often
 * repeats only what changed ("đổi sang sáng chủ nhật"), so the course, branch or service stay.
 * When the update gives `preferredDate` or `preferredTime`, both old ones are dropped first, so a
 * new time never sits next to the old day.
 */
export function mergeRequestDetails(
  previous: Readonly<Record<string, unknown>> | null,
  next: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const given = (v: unknown) =>
    typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined;
  const stored = (previous?.['details'] ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) if (typeof v === 'string' && v.trim()) out[k] = v;
  if (WHEN_FIELDS.some((k) => given(next[k]))) for (const k of WHEN_FIELDS) delete out[k];
  for (const [k, v] of Object.entries(next)) if (given(v)) out[k] = v;
  return out;
}

/**
 * Whether a stored request entry's data (`{kind, details, dateLabel}`) holds exactly these details
 * and day label: a retried call, or the same call twice in one turn, which writes nothing.
 */
export function sameRequest(
  data: Readonly<Record<string, unknown>>,
  details: Readonly<Record<string, string>>,
  label: string | null,
): boolean {
  const stored = (data['details'] ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(stored), ...Object.keys(details)]);
  return (data['dateLabel'] ?? null) === label && [...keys].every((k) => stored[k] === details[k]);
}

/** The fields that make a request's slot: changing one of them reschedules it (MS-10). */
const SLOT_FIELDS = ['preferredDate', 'preferredTime', 'branch', 'service', 'course'] as const;

/** Whether an update moves the slot of the stored request (`{kind, details, dateLabel}` data). */
export function slotChanged(
  earlier: Readonly<Record<string, unknown>>,
  details: Readonly<Record<string, string>>,
): boolean {
  const stored = (earlier['details'] ?? {}) as Record<string, unknown>;
  return SLOT_FIELDS.some((k) => (stored[k] ?? '') !== (details[k] ?? ''));
}

/** Subject of the open task that asks staff to confirm a customer's request (one per customer). */
export const REQUEST_TASK_SUBJECT = 'customer_request';
/** Title prefix of that task once the customer moved a confirmed slot. */
export const RESCHEDULED_PREFIX = 'Khách đổi lịch';

/** Weekday names and d/m dates in a time wish ("9h sáng Chủ nhật 15/11"), for removal. */
const DAY_WORDS =
  /\s*(?:(?:vào\s+)?(?:thứ\s*(?:hai|ba|tư|tu|năm|nam|sáu|sau|bảy|bay|[2-7])|chủ\s*nhật|chu\s*nhat|cn)(?![\p{L}\p{N}])|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|ngày(?![\p{L}\p{N}]))/giu;

/** A time wish without the day it may repeat: "9h sáng Chủ nhật 15/11" → "9h sáng". */
export function withoutDay(time: string): string {
  return time
    .replace(DAY_WORDS, ' ')
    .replace(/\s*[,–-]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The staff task's title for a request (≤ 200 chars): "Xác nhận – <kind>: <name> – <day time>",
 * or "Khách đổi lịch – <kind>: …" when the customer moved a confirmed slot.
 */
export function requestTaskTitle(
  profile: RequestProfile,
  kind: CustomerRequestKind,
  details: Readonly<Record<string, unknown>>,
  label: string | null,
  rescheduled: boolean,
): string {
  const text = (k: string) => (typeof details[k] === 'string' ? (details[k] as string).trim() : '');
  const what = profile.kindLabels[kind] ?? kind;
  // The day comes once, from the structured date: the customer's time words may repeat it.
  const time = label ? withoutDay(text('preferredTime')) : text('preferredTime');
  const when = [label, time].filter(Boolean).join(' ');
  const who = [text('name'), when].filter(Boolean).join(' – ');
  const head = `${rescheduled ? RESCHEDULED_PREFIX : 'Xác nhận'} – ${what}`;
  return (who ? `${head}: ${who}` : head).slice(0, 200);
}

/**
 * Whether a request moves the customer to `move.key`. `currentKey` is the built-in key of the
 * customer's status (null: none or a custom status). `positions` are the pipeline positions of the
 * current status (null: none) and of the target.
 *
 * - `forward_only` (saas, ADR-020): never back, never sideways: moves only when the customer has no
 *   status or one earlier in the pipeline order.
 * - `unless`: moves unless the customer is already at the target or at a `keep` (confirmed) status.
 */
export function decideStatusMove(
  move: RequestStatusMove,
  currentKey: string | null,
  positions: { current: number | null; target: number },
  /** The update moved the slot: a `reopen` status goes back to the target (MS-10). */
  rescheduled = false,
): boolean {
  if (currentKey !== null && currentKey === move.key) return false;
  if (rescheduled && move.move === 'unless' && currentKey && move.reopen?.includes(currentKey))
    return true;
  if (move.move === 'forward_only')
    return positions.current === null || positions.current < positions.target;
  return currentKey === null || !move.keep.includes(currentKey);
}

/** The free-text fields a model sometimes puts a course or service name into instead (T-187). */
const ITEM_SOURCES: Readonly<Record<string, readonly string[]>> = {
  course: ['goal'],
  service: ['note'],
};

/** Words of a course or service name too generic to identify one ("khoá học", "lớp", "dịch vụ"). */
const GENERIC_WORDS = new Set(['khoa', 'hoc', 'lop', 'cho', 'dich', 'vu', 'goi']);

const words = (text: string): string[] =>
  foldVietnamese(text)
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w && !GENERIC_WORDS.has(w));

/**
 * The catalog name `text` names: every distinctive word of the name is in the text ("Học khoá
 * Starters" → "Khóa học Starters"); the longest such name wins. Null when none fits or two tie.
 * A part of a name ("IELTS 6.5") is a goal, not a course: it fills nothing.
 */
export function catalogNameIn(text: string, names: readonly string[]): string | null {
  const said = words(text);
  if (!said.length) return null;
  const has = (all: string[], part: string[]) => part.every((w) => all.includes(w));
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const named = unique.filter((n) => {
    const w = words(n);
    return w.length > 0 && has(said, w);
  });
  if (!named.length) return null;
  // The longest name the text contains ("IELTS Foundation 5.5" over "IELTS"), when one is longest.
  const size = (n: string) => words(n).length;
  const top = Math.max(...named.map(size));
  const best = named.filter((n) => size(n) === top);
  return best.length === 1 ? (best[0] ?? null) : null;
}

/**
 * The details with the course (education) or service (spa) filled from the catalog when the model
 * left it empty but wrote the item's name into goal or note: `customer_requests.item` and the
 * request card read it. The source field keeps its text.
 */
export function withCatalogItem(
  details: Readonly<Record<string, unknown>>,
  catalogNames: readonly string[],
): Record<string, unknown> {
  const out = { ...details };
  if (!catalogNames.length) return out;
  for (const [item, sources] of Object.entries(ITEM_SOURCES)) {
    if (!(item in out) || (typeof out[item] === 'string' && out[item].trim())) continue;
    for (const source of sources) {
      const text = out[source];
      const name = typeof text === 'string' ? catalogNameIn(text, catalogNames) : null;
      if (name) {
        out[item] = name;
        break;
      }
    }
  }
  return out;
}
