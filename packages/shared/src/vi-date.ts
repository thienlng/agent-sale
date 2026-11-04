/**
 * Vietnamese weekday and day labels of a calendar date ('YYYY-MM-DD'). One spelling for every
 * customer- and staff-facing date the server writes (lodging holds, bot-recorded requests): the
 * house style capitalises both words ("Thứ Bảy", "Chủ Nhật").
 */

const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC midnight of a valid 'YYYY-MM-DD' calendar date, or null. */
function parseDate(yyyyMmDd: string): Date | null {
  if (!DATE.test(yyyyMmDd)) return null;
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== yyyyMmDd) return null;
  return d;
}

/** "Thứ Sáu" for a Friday, "Chủ Nhật" for a Sunday; '' for a value that is not a date. */
export function vietnameseWeekday(yyyyMmDd: string): string {
  const d = parseDate(yyyyMmDd);
  return d ? (WEEKDAYS[d.getUTCDay()] ?? '') : '';
}

/** "Thứ Bảy 07/11/2026" for `2026-11-07`; null for a value that is not a calendar date. */
export function vietnameseDateLabel(yyyyMmDd: string): string | null {
  const d = parseDate(yyyyMmDd);
  if (!d) return null;
  const [y, m, day] = yyyyMmDd.split('-');
  return `${WEEKDAYS[d.getUTCDay()]} ${day}/${m}/${y}`;
}
