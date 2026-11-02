/**
 * Vietnamese number, money and weight readers for the product import (T-173). Pure.
 *
 * `parseNumberVi` is the same rule as the web's 1b `parseFormNumber`
 * (apps/web/src/lib/assistant-context.ts); apps may not import each other, so it is
 * re-implemented here with the same test cases.
 */

/**
 * Reads a number written Vietnamese style. Dots followed by exactly three digits are thousands
 * separators ("150.000" is 150000); any other dot is the decimal point ("12.5"). A comma followed
 * by one or two final digits is the decimal comma ("12,5"); other commas are thousands
 * separators. Units and spaces are ignored. NaN when nothing sensible is left.
 */
export function parseNumberVi(raw: string): number {
  let text = raw.replace(/[^\d.,-]/g, '');
  const negative = text.startsWith('-');
  text = text.replace(/-/g, '');
  if (/,\d{1,2}$/.test(text)) {
    const at = text.lastIndexOf(',');
    text = `${text.slice(0, at).replace(/[.,]/g, '')}.${text.slice(at + 1)}`;
  } else {
    text = text.replace(/,/g, '').replace(/\.(?=\d{3}(?!\d))/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  const n = Number(text);
  return negative ? -n : n;
}

export const MAX_MONEY_VND = 1_000_000_000_000;

const MONEY_UNITS: Record<string, number> = {
  k: 1_000,
  nghìn: 1_000,
  nghin: 1_000,
  ngàn: 1_000,
  ngan: 1_000,
  tr: 1_000_000,
  triệu: 1_000_000,
  trieu: 1_000_000,
  m: 1_000_000,
  tỷ: 1_000_000_000,
  tỉ: 1_000_000_000,
  ty: 1_000_000_000,
};

const CURRENCY_SUFFIX = /\s*(?:₫|vnđ|vnd|đồng|dong|đ)\.?$/u;
const MONEY_SHAPE = /^([\d.,]+)\s*([\p{L}]+)?(\d{1,3})?$/u;

/**
 * Reads a price as integer VND: "150000", "150.000", "150,000", "150.000đ", "150.000 ₫",
 * "150000 VND", "150k", "1,5tr", "1.5 triệu", "2tr5" (2 500 000). Null for text, negatives
 * and values over 10¹².
 */
export function parseMoneyVnd(raw: string | number): number | null {
  if (typeof raw === 'number') return moneyOrNull(raw);
  let text = raw.normalize('NFC').trim().toLowerCase();
  if (text.startsWith('-')) return null;
  text = text.replace(CURRENCY_SUFFIX, '').trim();
  // Spaces between digits are thousands separators ("1 500 000").
  text = text.replace(/(\d)\s+(?=\d)/g, '$1');
  const match = MONEY_SHAPE.exec(text);
  if (!match) return null;
  const [, digits = '', unit, tail] = match;
  const base = parseNumberVi(digits);
  if (!Number.isFinite(base)) return null;
  if (!unit) return tail === undefined ? moneyOrNull(base) : null;
  const multiplier = MONEY_UNITS[unit];
  if (multiplier === undefined) return null;
  if (tail === undefined) return moneyOrNull(base * multiplier);
  // "2tr5" = 2.5 million, "1k5" = 1 500: the tail is the fraction of the unit.
  if (!Number.isInteger(base)) return null;
  return moneyOrNull((base + Number(`0.${tail}`)) * multiplier);
}

function moneyOrNull(n: number): number | null {
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n);
  return rounded <= MAX_MONEY_VND ? rounded : null;
}

const WEIGHT_UNITS: Record<string, number> = {
  g: 1,
  gr: 1,
  gram: 1,
  grams: 1,
  gam: 1,
  kg: 1_000,
  kgs: 1_000,
  ký: 1_000,
  kí: 1_000,
};
const WEIGHT_SHAPE = /^([\d.,]+)\s*([\p{L}]+)?$/u;

/** Reads a weight in grams: "500g", "1,2kg", "1.2 kg", or a bare number (grams). Null when bad. */
export function parseWeightGrams(raw: string | number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const text = raw.normalize('NFC').trim().toLowerCase();
  const match = WEIGHT_SHAPE.exec(text);
  if (!match) return null;
  const [, digits = '', unit] = match;
  const multiplier = unit === undefined ? 1 : WEIGHT_UNITS[unit];
  if (multiplier === undefined) return null;
  const n = parseNumberVi(digits);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * multiplier);
}
