/**
 * Who a signup trial belongs to (ADR-021 §6): one trial per person, not per spelling of an
 * address. Accounts stay unique by the exact (lower-cased) email; only the trial uses this.
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Disposable-inbox domains that get no signup trial (signup itself still works). Short on purpose:
 * the common throwaway services; operators add more with `TRIAL_BLOCKED_EMAIL_DOMAINS`.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  '10minutemail.com',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'maildrop.cc',
  'mailinator.com',
  'mintemail.com',
  'mohmal.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
];

/**
 * The canonical form of an address for the trial: lower-cased, the `+tag` dropped, and for Gmail
 * (which ignores dots and treats googlemail.com as gmail.com) the dots dropped too. Migration 0076
 * backfills with the same rule in SQL; change both together.
 */
export function canonicalTrialEmail(address: string): string {
  const email = address.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at).split('+')[0] ?? '';
  let domain = email.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

/** Whether the address is on a disposable domain (or a subdomain of one). */
export function isDisposableEmail(address: string, extraDomains: readonly string[] = []): boolean {
  const domain = address.trim().toLowerCase().split('@').at(-1) ?? '';
  return [...DISPOSABLE_EMAIL_DOMAINS, ...extraDomains].some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}

/** `TRIAL_BLOCKED_EMAIL_DOMAINS` as a list of lower-cased domains. */
export function parseBlockedDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}
