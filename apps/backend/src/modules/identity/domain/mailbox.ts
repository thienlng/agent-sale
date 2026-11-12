const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * The inbox an address delivers to: lower-cased, the `+tag` dropped, and for Gmail (which ignores
 * dots and treats googlemail.com as gmail.com) the dots dropped too. Used where the person or the
 * inbox matters, not the spelling: the signup trial (one per person, ADR-021 §6) and the caps on
 * code emails (no bombing one inbox through its variants). Accounts and stored codes stay keyed on
 * the exact (lower-cased) address. Migration 0076 backfills trial claims with the same rule in
 * SQL; change both together.
 */
export function canonicalMailbox(address: string): string {
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
