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
    .replace(/[\u0300-\u036f]/g, '')
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
/**
 * Sensitive-data patterns, one source of truth for the scanner, the redactor
 * and the owner secret masker. Non-global: build a global copy with `globalOf`.
 */
export const URL_PATTERN = /(?:https?:\/\/|\bwww\.)[^\s<>"'`]*/i;
export const PHONE_PATTERN = /(?<!\d)(?:\+84|0)[\s.]?[35789](?:[\s.]?\d){8}(?!\d)/;
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
export const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[^\s'"]{16,}/,
];
/** A 32+ char hex/base64 run; it counts only when it mixes letters and digits. */
export const LONG_RUN_PATTERN = /[A-Za-z0-9+/=_-]{32,}/;

function globalOf(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}

function isSecretRun(run: string): boolean {
  return /\d/.test(run) && /[A-Za-z]/.test(run);
}

function hasSecretRun(text: string): boolean {
  for (const m of text.matchAll(globalOf(LONG_RUN_PATTERN))) {
    if (isSecretRun(m[0])) return true;
  }
  return false;
}

export function scanUntrustedText(text: string): SafetyResult {
  const issues: SafetyIssue[] = [];
  const plain = unaccent(text);
  if (INJECTION_PATTERNS.some((re) => re.test(plain))) issues.push('injection');
  if (ROLE_OVERRIDE.test(plain)) issues.push('role_override');
  if (INVISIBLE_UNICODE.test(text)) issues.push('invisible_unicode');
  if (URL_PATTERN.test(text)) issues.push('url');
  if (PHONE_PATTERN.test(text)) issues.push('phone');
  if (EMAIL_PATTERN.test(text)) issues.push('email');
  if (SECRET_PATTERNS.some((re) => re.test(text)) || hasSecretRun(text)) issues.push('secret');
  return { ok: issues.length === 0, issues };
}

/** Replaces secret-shaped runs (sk-…, Bearer …, long mixed hex/base64) with `token`. */
function replaceSecrets(text: string, token: string, onHit?: () => void): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(globalOf(re), () => {
      onHit?.();
      return token;
    });
  }
  return out.replace(globalOf(LONG_RUN_PATTERN), (run) => {
    if (!isSecretRun(run)) return run;
    onHit?.();
    return token;
  });
}

/**
 * Replaces phones, e-mails, URLs and secret-shaped strings with `[phone]`,
 * `[email]`, `[url]`, `[secret]`; collapses whitespace; cuts at `max` chars on
 * a word boundary (never inside a replacement token). Pure.
 */
export function redactSensitive(text: string, max: number): string {
  let out = text.replace(globalOf(URL_PATTERN), '[url]');
  out = out.replace(globalOf(EMAIL_PATTERN), '[email]');
  out = replaceSecrets(out, '[secret]');
  out = out.replace(globalOf(PHONE_PATTERN), '[phone]');
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length <= max) return out;
  let cut = out.slice(0, max);
  const space = cut.lastIndexOf(' ');
  if (out[max] !== ' ') {
    cut = space > 0 ? cut.slice(0, space) : cut;
  }
  // A hard cut (no space to fall back on) must not leave half a token.
  cut = cut.replace(/\[[a-z]*$/, '');
  return cut.trimEnd();
}

export const SECRET_REMOVED = '[secret removed]';

const SECRET_NAME =
  '[A-Za-z0-9_-]*(?:key|token|secret|password|passwd|auth|signature|cookie)[A-Za-z0-9_-]*';
const NOT_MASKED = '(?!\\[secret removed\\])';
/** `Name: value` (header line, `-H '…'`, `--header "…"`); an auth scheme word is kept. */
const AUTH_SCHEME = '(?:Bearer|Basic|Token|Digest|ApiKey|Key)\\s+';
const HEADER_RE = new RegExp(
  `(?<![A-Za-z0-9_-])(${SECRET_NAME})(\\s*:\\s*)(?!${AUTH_SCHEME}\\[secret removed\\])(${AUTH_SCHEME})?${NOT_MASKED}([^\\s'"]+)`,
  'gi',
);
/** `name=value` in a query string or form body. */
const PARAM_RE = new RegExp(`(?<![A-Za-z0-9_-])(${SECRET_NAME})=${NOT_MASKED}([^&\\s'"#]+)`, 'gi');
/** `"name": "value"` JSON members with a string value. */
const JSON_RE = new RegExp(
  `("${SECRET_NAME}"\\s*:\\s*")${NOT_MASKED}((?:[^"\\\\]|\\\\.)+)(")`,
  'gi',
);
/** curl `-u user:pass` / `--user user:pass`. */
const USER_RE = new RegExp(
  `((?:^|\\s)(?:-u|--user)(?:\\s+|=))(['"]?)${NOT_MASKED}([^\\s'"]+)\\2`,
  'g',
);

/**
 * Masks credentials an owner pasted (curl commands, headers, query/body keys,
 * JSON members, `-u user:pass`, free-standing tokens). Keys stay so the model
 * can infer the auth kind; values become `[secret removed]`. Idempotent.
 */
export function maskOwnerSecrets(text: string): { text: string; removed: number } {
  let removed = 0;
  const hit = () => {
    removed += 1;
  };
  let out = text.replace(HEADER_RE, (_m, name: string, sep: string, scheme: string | undefined) => {
    hit();
    return `${name}${sep}${scheme ?? ''}${SECRET_REMOVED}`;
  });
  out = out.replace(PARAM_RE, (_m, name: string) => {
    hit();
    return `${name}=${SECRET_REMOVED}`;
  });
  out = out.replace(JSON_RE, (_m, head: string, _v: string, tail: string) => {
    hit();
    return `${head}${SECRET_REMOVED}${tail}`;
  });
  out = out.replace(USER_RE, (_m, flag: string, quote: string) => {
    hit();
    return `${flag}${quote}${SECRET_REMOVED}${quote}`;
  });
  out = replaceSecrets(out, SECRET_REMOVED, hit);
  return { text: out, removed };
}
