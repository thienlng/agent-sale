import { normalizeVnPhone } from '@agent-sales/shared';

/**
 * Client-side phone check. Vietnamese mobiles are normalised to E.164; a number
 * written with a `+` country code (8-15 digits) is passed through for the server
 * to decide. Returns null when the input is unusable.
 */
export function checkPhone(input: string): string | null {
  const trimmed = input.trim();
  const vn = normalizeVnPhone(trimmed);
  if (vn) return vn;
  const digits = trimmed.replace(/\D/g, '');
  if (/^\+|^\(\+/.test(trimmed) && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Client-side email shape check (the server normalises and rejects placeholders). */
export function checkEmail(input: string): string | null {
  const trimmed = input.trim();
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed) ? trimmed : null;
}
