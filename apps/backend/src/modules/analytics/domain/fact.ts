/** What the projector records. One fact per (outbox event, kind); ids and times only. */
export const FACT_KINDS = [
  'customer.created',
  'phone.captured',
  'tag.assigned',
  'tag.removed',
  'status.changed',
  'assignment.changed',
  'conversation.opened',
  'message.inbound',
  'message.outbound',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface OutboxRow {
  id: number;
  workspaceId: string | null;
  type: string;
  /** The aggregate the event is about (a customer or a conversation). */
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
}

export interface FactDraft {
  workspaceId: string;
  outboxId: number;
  kind: FactKind;
  occurredAt: Date;
  /** When the projection's source (the outbox) recorded it. */
  receivedAt: Date;
  origin: 'channel' | 'manual' | 'import' | 'rule';
  contactId: string | null;
  conversationId: string | null;
  channelId: string | null;
  subjectId: string | null;
  fromSubjectId: string | null;
  refId: string | null;
  role: 'sales' | 'care' | null;
}
