/**
 * Vietnamese phone number normalization. Contacts are stored in E.164
 * (`+84xxxxxxxxx`) and displayed as `0xxxxxxxxx`. See docs/05-data-model.md §9.
 */

const VN_MOBILE_PREFIXES = /^(3[2-9]|5[2689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;

/**
 * Normalizes user input to E.164 for Vietnam. Accepts `0912345678`,
 * `84912345678`, `+84 912 345 678`, `(+84)912-345-678`. Returns `null` when the
 * input is not a valid Vietnamese mobile number.
 */
export function normalizeVnPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national: string;
  if (digits.startsWith('84') && digits.length === 11) {
    national = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 10) {
    national = digits.slice(1);
  } else if (digits.length === 9) {
    national = digits;
  } else {
    return null;
  }
  return VN_MOBILE_PREFIXES.test(national) ? `+84${national}` : null;
}

/** Formats an E.164 Vietnamese number for display: `+84912345678` → `0912345678`. */
export function formatVnPhone(e164: string): string {
  if (!e164.startsWith('+84') || e164.length !== 12) {
    throw new RangeError(`not a Vietnamese E.164 number: ${e164}`);
  }
  return `0${e164.slice(3)}`;
}

/** Masks a phone number for logs: `+84912345678` → `+84912***678`. */
export function maskPhone(e164: string): string {
  return e164.length < 7 ? '***' : `${e164.slice(0, 6)}***${e164.slice(-3)}`;
}

/**
 * Normalizes any usable phone input to E.164: Vietnamese mobiles via
 * normalizeVnPhone, other numbers written with a `+` country code as `+digits`
 * (8–15 digits). Returns null for anything else (e.g. a Vietnamese landline
 * without `+84`, or text). Used for customer identity and duplicate detection.
 */
export function normalizeAnyPhone(input: string): string | null {
  const vn = normalizeVnPhone(input);
  if (vn) return vn;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  return /^\+|^\(\+/.test(trimmed) && digits.length >= 8 && digits.length <= 15
    ? `+${digits}`
    : null;
}

/** Lower-cased, trimmed email for identity and duplicate checks. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
