/**
 * Who a signup trial belongs to (ADR-021 §6): one trial per person, not per spelling of an
 * address (`canonicalMailbox`). Accounts stay unique by the exact (lower-cased) email.
 */

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
