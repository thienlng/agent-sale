import { CrmEvents, MessageReceivedPayload, ReplyCompletedPayload } from '@agent-sales/contracts';

import type { FactDraft, OutboxRow } from '../domain/fact.js';

type Common = Pick<FactDraft, 'workspaceId' | 'outboxId' | 'receivedAt'>;
const blank = {
  contactId: null,
  conversationId: null,
  channelId: null,
  botId: null,
  subjectId: null,
  fromSubjectId: null,
  refId: null,
  role: null,
} as const;

/**
 * Turns one outbox event into the facts statistics need (none for events it
 * does not care about). A malformed payload throws: the projector dead-letters
 * it and moves on. Nothing here talks to the outside world.
 */
export function mapOutboxEvent(row: OutboxRow): FactDraft[] {
  if (!row.workspaceId) return [];
  const common: Common = {
    workspaceId: row.workspaceId,
    outboxId: row.id,
    receivedAt: row.createdAt,
  };
  if (row.type.startsWith('crm.')) return fromCrm(row, common);
  if (row.type === 'conversation.message.received.v1') return fromReceived(row, common);
  if (row.type === 'conversation.reply.completed.v1') return fromReply(row, common);
  return [];
}

function fromCrm(row: OutboxRow, c: Common): FactDraft[] {
  const parsed = CrmEvents.safeParse({ ...(row.payload as object), type: row.type });
  if (!parsed.success) {
    // A CRM event type this version does not know is skipped; a known type with a bad payload is an error.
    if (!CrmEvents.options.some((o) => o.shape.type.value === row.type)) return [];
    throw parsed.error;
  }
  const e = parsed.data;
  const at = new Date(e.occurredAt);
  // People act, automation does not: no actor means a rule.
  const origin = e.actorUserId ? ('manual' as const) : ('rule' as const);
  const fact = (kind: FactDraft['kind'], rest: Partial<FactDraft>): FactDraft => ({
    ...c,
    ...blank,
    kind,
    occurredAt: at,
    origin,
    contactId: e.contactId,
    ...rest,
  });
  switch (e.type) {
    case 'crm.contact.created.v1':
      return [
        fact('customer.created', { origin: e.origin }),
        ...(e.phoneCaptured ? [fact('phone.captured', { origin: e.origin })] : []),
        // Where the customer started; later moves are `status.changed`.
        ...(e.statusId ? [fact('status.initial', { subjectId: e.statusId })] : []),
      ];
    case 'crm.contact.updated.v1':
      return e.phoneCaptured ? [fact('phone.captured', { origin: 'manual' })] : [];
    case 'crm.contact.status_changed.v1':
      return [fact('status.changed', { subjectId: e.toStatusId, fromSubjectId: e.fromStatusId })];
    case 'crm.contact.assigned.v1':
      return [
        fact('assignment.changed', {
          role: e.role,
          subjectId: e.toUserId,
          fromSubjectId: e.fromUserId,
        }),
      ];
    case 'crm.contact.initial_status.v1':
      return [fact('status.initial', { subjectId: e.statusId })];
    case 'crm.tag.assigned.v1':
      return [fact('tag.assigned', { subjectId: e.tagId, refId: e.assignmentId })];
    case 'crm.tag.removed.v1':
      return [fact('tag.removed', { subjectId: e.tagId, refId: e.assignmentId })];
  }
}

function fromReceived(row: OutboxRow, c: Common): FactDraft[] {
  const p = MessageReceivedPayload.parse(row.payload);
  const base = {
    ...c,
    ...blank,
    origin: 'channel' as const,
    occurredAt: p.occurredAt ? new Date(p.occurredAt) : row.createdAt,
    conversationId: row.aggregateId,
    channelId: p.channelId ?? null,
    botId: p.botId ?? null,
  };
  if (p.type === 'echo') return [{ ...base, kind: 'message.outbound' }];
  return [
    { ...base, kind: 'message.inbound' },
    ...(p.firstMessage ? [{ ...base, kind: 'conversation.opened' as const }] : []),
  ];
}

function fromReply(row: OutboxRow, c: Common): FactDraft[] {
  const p = ReplyCompletedPayload.parse(row.payload);
  if (p.status !== 'sent') return [];
  return [
    {
      ...c,
      ...blank,
      kind: 'message.outbound',
      origin: 'channel',
      occurredAt: p.occurredAt ? new Date(p.occurredAt) : row.createdAt,
      conversationId: row.aggregateId,
      channelId: p.channelId ?? null,
      botId: p.botId ?? null,
    },
  ];
}
