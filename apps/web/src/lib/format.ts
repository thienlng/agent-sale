/** Number, money and date formatting for the current UI locale (Vietnamese by default). */
const locale = () => (document.documentElement.lang === 'en' ? 'en-US' : 'vi-VN');

/** 150000 → "150.000 ₫" (vi) / "₫150,000" (en). Money is integer VND everywhere. */
export function formatVnd(amount: number): string {
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: fractionDigits }).format(n);
}

/** Short money for chart axes: 1.250.000 → "1,3 tr" (vi) / "1.3M" (en). */
export function formatCompactVnd(amount: number): string {
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(
    amount,
  );
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit' }).format(
    new Date(`${iso}T00:00:00`),
  );
}

/** A yyyy-mm-dd calendar day with its year, e.g. 03/11/2026. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00`));
}

/**
 * A yyyy-mm-dd day in the one short Vietnamese form: "05/03", or "05/03/2027" when it is not
 * in the year of `today` (yyyy-mm-dd, default: the browser's today). Built by hand because
 * Intl's vi-VN day+month pattern prints "05-03".
 */
export function formatShortDate(iso: string, today: string = isoDate(new Date())): string {
  const dm = `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? dm : `${dm}/${iso.slice(0, 4)}`;
}

/** yyyy-mm-dd of a local Date (the browser's day; the API buckets by the shop's time zone). */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/** "2 phút trước" / "2 minutes ago" for a past instant (future instants read as "now"). */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  let value = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  // "auto" only for seconds ("now"); larger units stay numeric ("2 ngày trước", not "Hôm kia").
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'always' });
  if (value < 1)
    return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(0, 'second');
  for (const [unit, size] of RELATIVE_STEPS) {
    if (value < size) return rtf.format(-Math.floor(value), unit);
    value /= size;
  }
  return rtf.format(-Math.floor(value), 'year');
}

/**
 * A phone number as Vietnamese people write it: "+84912000111" → "0912 000 111", a landline
 * "+842438123456" → "024 3812 3456". Other numbers stay as stored. Display only: links and copy
 * keep the stored E.164 form.
 */
export function formatPhone(phone: string): string {
  const compact = phone.replace(/[\s.()-]/g, '');
  const local = compact.startsWith('+84')
    ? `0${compact.slice(3)}`
    : compact.startsWith('84') && compact.length === 11
      ? `0${compact.slice(2)}`
      : compact;
  if (!/^0\d+$/.test(local)) return phone;
  if (local.length === 10) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  if (local.length === 11) return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
  return local;
}
