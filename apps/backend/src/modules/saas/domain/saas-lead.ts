import type { SaasStage } from '@agent-sales/contracts';

/**
 * Built-in customer status (crm `SAAS_STATUSES` key) each subscription stage puts the customer
 * in. The subscription is the only writer of these five statuses (ADR-020).
 */
export const STAGE_STATUS: Record<SaasStage, string> = {
  trial: 'trial',
  free: 'free_plan',
  active: 'paying',
  past_due: 'past_due',
  canceled: 'churned',
};

/** Add `days` to a yyyy-mm-dd calendar date. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
