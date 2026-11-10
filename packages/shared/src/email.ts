import { normalizeEmail } from './phone.js';

/** A practical address shape: local part, one `@`, a dotted domain with a 2+ letter TLD. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
/** Placeholder addresses people type when they do not want to give one. */
const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com', 'email.com'];

/**
 * A usable lead email, normalized (`normalizeEmail`), or null: at most 254 characters, a local
 * part of at most 64 without leading, trailing or doubled dots, and not a placeholder domain.
 */
export function normalizeLeadEmail(input: string): string | null {
  const email = normalizeEmail(input);
  if (email.length > 254 || !new RegExp(`^${EMAIL.source}$`).test(email)) return null;
  const [local = '', domain = ''] = email.split('@');
  if (local.length > 64 || /^\.|\.$|\.\./.test(local) || /\.\./.test(domain)) return null;
  return PLACEHOLDER_DOMAINS.includes(domain) ? null : email;
}

/** First usable email address in free text, normalized; null when there is none. */
export function findEmail(text: string): string | null {
  for (const candidate of text.match(EMAIL) ?? []) {
    const email = normalizeLeadEmail(candidate.replace(/^[._%+-]+/, ''));
    if (email) return email;
  }
  return null;
}

/** Masks an email for logs: `lan.nguyen@shop.vn` → `la***@shop.vn`. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
