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

/** yyyy-mm-dd of a local Date (the browser's day; the API buckets by the shop's time zone). */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
