import type { SaasLeadDetails, SaasRequestKind, SaasStage } from '@agent-sales/contracts';

/**
 * Built-in customer status (crm `SAAS_STATUSES` key) each subscription stage puts the customer
 * in. The subscription is the only writer of these four statuses (ADR-014).
 */
export const STAGE_STATUS: Record<SaasStage, string> = {
  trial: 'trial',
  active: 'paying',
  past_due: 'past_due',
  canceled: 'churned',
};
/** Status a bot-recorded demo / trial / consultation request moves a customer forward to. */
export const REQUESTED_STATUS = 'requested';

const KIND_LABEL: Record<SaasRequestKind, string> = {
  demo: 'Xin demo',
  trial: 'Xin dùng thử',
  consultation: 'Xin tư vấn',
};

/**
 * The note the bot leaves on the customer: what was asked and what the customer said, one line
 * per given detail. Staff read it in Vietnamese, so the labels are Vietnamese (business content).
 */
export function leadNote(kind: SaasRequestKind, lead: SaasLeadDetails): string {
  const lines: [string, string | null][] = [
    ['Công ty', lead.company],
    ['Quy mô', lead.teamSize],
    ['Nhu cầu', lead.need],
    ['Thời gian mong muốn', lead.preferredTime],
    ['Gói quan tâm', lead.planInterest],
    ['Email', lead.email],
  ];
  return [
    `${KIND_LABEL[kind]} (bot ghi nhận)`,
    ...lines.filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
}

/** Add `days` to a yyyy-mm-dd calendar date. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
