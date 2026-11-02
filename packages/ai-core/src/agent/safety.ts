/**
 * Scanner for untrusted text that may end up in the assistant's context
 * (memory entries, skills). It flags prompt-injection phrasing, role
 * overrides, invisible unicode and data that must not be stored (URLs,
 * Vietnamese phone numbers, e-mail addresses, secrets). Pure and synchronous.
 */
export type SafetyIssue =
  'injection' | 'role_override' | 'invisible_unicode' | 'url' | 'phone' | 'email' | 'secret';

export interface SafetyResult {
  ok: boolean;
  issues: SafetyIssue[];
}

/** Lowercase, accent-free form so Vietnamese phrases match with or without diacritics. */
function unaccent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+|the\s+)?(?:all|previous|above|prior)\s+(?:\w+\s+)?instructions?\b/,
  /\bbo\s+qua\s+(?:moi|cac|tat\s+ca)\s+(?:\w+\s+)?huong\s+dan\b/,
  /\bsystem\s+prompt\b/,
  /\byou\s+are\s+now\b/,
  /\bdeveloper\s+mode\b/,
];

const ROLE_OVERRIDE = /^[ \t]*(?:system:|assistant:|<system)/m;
const INVISIBLE_UNICODE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;
const URL = /https?:\/\/|\bwww\./i;
const PHONE = /(?<!\d)(?:\+84|0)[\s.]?[35789](?:[\s.]?\d){8}(?!\d)/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const SECRET_PATTERNS: RegExp[] = [/sk-[A-Za-z0-9]{16,}/, /Bearer\s+\S{16,}/];
const LONG_RUN = /[A-Za-z0-9+/=]{32,}/g;

/** A 32+ char hex/base64 run; it must mix letters and digits so long plain words do not count. */
function hasSecretRun(text: string): boolean {
  for (const m of text.matchAll(LONG_RUN)) {
    if (/\d/.test(m[0]) && /[A-Za-z]/.test(m[0])) return true;
  }
  return false;
}

export function scanUntrustedText(text: string): SafetyResult {
  const issues: SafetyIssue[] = [];
  const plain = unaccent(text);
  if (INJECTION_PATTERNS.some((re) => re.test(plain))) issues.push('injection');
  if (ROLE_OVERRIDE.test(plain)) issues.push('role_override');
  if (INVISIBLE_UNICODE.test(text)) issues.push('invisible_unicode');
  if (URL.test(text)) issues.push('url');
  if (PHONE.test(text)) issues.push('phone');
  if (EMAIL.test(text)) issues.push('email');
  if (SECRET_PATTERNS.some((re) => re.test(text)) || hasSecretRun(text)) issues.push('secret');
  return { ok: issues.length === 0, issues };
}
