/**
 * LM-17: a customer wrote a weekday and a date that disagree ("thứ 7 15/11/2027" while 15/11/2027
 * is a Monday). Recording either one silently books the wrong day, so the request tool asks first.
 */
const WEEKDAY: Record<string, number> = {
  '2': 1,
  hai: 1,
  '3': 2,
  ba: 2,
  '4': 3,
  tư: 3,
  tu: 3,
  '5': 4,
  năm: 4,
  nam: 4,
  '6': 5,
  sáu: 5,
  sau: 5,
  '7': 6,
  bảy: 6,
  bay: 6,
};
const NAMES = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const PATTERN =
  /(?<!\p{L})(?:(?:thứ|thu|t)\s*(2|3|4|5|6|7|hai|ba|tư|tu|năm|nam|sáu|sau|bảy|bay)|(chủ nhật|chu nhat|cn))(?![\p{L}])[^\d\n]{0,20}(\d{1,2})\/(\d{1,2})/giu;

const DAY_MS = 86_400_000;

/**
 * The customer's newest message pairs a weekday with a date that is another weekday ("thứ 7 tuần
 * này 15/11" while 15/11 is a Sunday) near `yyyyMmDd` (within a week, whichever of the two the
 * model resolved, LM2-6): returns what the date really is ("15/11 là Chủ Nhật"), else null. Only
 * the newest message counts, so the customer's answer to the question ends the refusal.
 */
export function weekdayMismatch(yyyyMmDd: string, customerTexts: readonly string[]): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return null;
  const year = Number(m[1]);
  const picked = Date.UTC(year, Number(m[2]) - 1, Number(m[3]));
  for (const hit of (customerTexts.at(-1) ?? '').matchAll(PATTERN)) {
    const day = Number(hit[3]);
    const month = Number(hit[4]);
    const named = Date.UTC(year, month - 1, day);
    if (Math.abs(named - picked) > 7 * DAY_MS) continue;
    const said = hit[2] ? 0 : WEEKDAY[(hit[1] ?? '').toLowerCase()];
    const actual = new Date(named).getUTCDay();
    if (said !== undefined && said !== actual)
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')} là ${NAMES[actual]}`;
  }
  return null;
}

/**
 * LM2-6 when the model passed no preferredDate: the newest message pairs a weekday with a date
 * that is another weekday ("thứ 7 ngày 15/11/2027", a Monday). The year is the one written, else
 * `now`'s year (next year once the date has passed). Returns "15/11 là Thứ Hai", else null.
 */
export function weekdayMismatchInText(customerTexts: readonly string[], now: Date): string | null {
  const text = customerTexts.at(-1) ?? '';
  for (const hit of text.matchAll(PATTERN)) {
    const day = Number(hit[3]);
    const month = Number(hit[4]);
    const written = /^\/(\d{4})/.exec(text.slice((hit.index ?? 0) + hit[0].length));
    let year = written ? Number(written[1]) : now.getUTCFullYear();
    if (!written && Date.UTC(year, month - 1, day) < now.getTime() - DAY_MS) year += 1;
    const actual = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const said = hit[2] ? 0 : WEEKDAY[(hit[1] ?? '').toLowerCase()];
    if (said !== undefined && said !== actual)
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')} là ${NAMES[actual]}`;
  }
  return null;
}
