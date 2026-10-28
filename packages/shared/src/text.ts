/**
 * Vietnamese-aware text helpers used for search keys and placeholder handling.
 */

/** Lowercase, strip diacritics (đ→d), collapse whitespace: "Giá  bao NHIÊU?" → "gia bao nhieu?". */
export function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;

/** Names of `{{placeholders}}` in a text, in order of first appearance. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))];
}

/** Replaces known placeholders; unknown ones are left as-is (callers decide what missing means). */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = values[name];
    return v !== undefined && v !== '' ? v : whole;
  });
}

const CONTACT_DETAILS = /(?:\b0[0-9 .-]{8,14}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

/** True when a text carries a phone number or email: public comment replies must not repeat them. */
export function exposesContactDetails(text: string): boolean {
  return CONTACT_DETAILS.test(text);
}
