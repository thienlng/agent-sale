import type { SaasLeadDetails, SaasRequestStatus } from '@agent-sales/contracts';

import { SaasError } from './saas.errors.js';

const NEXT: Record<SaasRequestStatus, readonly SaasRequestStatus[]> = {
  new: ['contacted', 'scheduled', 'converted', 'closed'],
  contacted: ['scheduled', 'converted', 'closed'],
  scheduled: ['contacted', 'converted', 'closed'],
  converted: [],
  closed: [],
};

/** Staff move a request forward; converted and closed are final. */
export function assertRequestTransition(from: SaasRequestStatus, to: SaasRequestStatus): void {
  if (from !== to && !NEXT[from].includes(to))
    throw new SaasError('CONFLICT', 'This request cannot move to that status');
}

/**
 * A repeated bot call fills in or corrects the lead: a given value replaces the stored one,
 * an empty value never erases what the customer said earlier.
 */
export function mergeLeadDetails(stored: SaasLeadDetails, next: SaasLeadDetails): SaasLeadDetails {
  const pick = (a: string, b: string) => (b.trim() ? b : a);
  return {
    name: pick(stored.name, next.name),
    phone: next.phone?.trim() ? next.phone : stored.phone,
    email: next.email ?? stored.email,
    company: pick(stored.company, next.company),
    teamSize: pick(stored.teamSize, next.teamSize),
    need: pick(stored.need, next.need),
    preferredTime: pick(stored.preferredTime, next.preferredTime),
    planInterest: pick(stored.planInterest, next.planInterest),
  };
}

const LEAD_KEYS = [
  'name',
  'phone',
  'email',
  'company',
  'teamSize',
  'need',
  'preferredTime',
  'planInterest',
] as const;

export function sameLead(a: SaasLeadDetails, b: SaasLeadDetails): boolean {
  return LEAD_KEYS.every((k) => a[k] === b[k]);
}

/** Add `days` to a yyyy-mm-dd calendar date. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
