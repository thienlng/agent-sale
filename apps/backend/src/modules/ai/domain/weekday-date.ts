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

/**
 * The weekday the date really is (e.g. "Thứ Hai") when a customer message names `yyyyMmDd`'s
 * day and month next to a different weekday; null when they agree or the date is not named.
 */
export function weekdayMismatch(yyyyMmDd: string, customerTexts: readonly string[]): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const actual = date.getUTCDay();
  for (const text of customerTexts)
    for (const hit of text.matchAll(PATTERN)) {
      if (Number(hit[3]) !== Number(m[3]) || Number(hit[4]) !== Number(m[2])) continue;
      const said = hit[2] ? 0 : WEEKDAY[(hit[1] ?? '').toLowerCase()];
      if (said !== undefined && said !== actual) return NAMES[actual] ?? null;
    }
  return null;
}
