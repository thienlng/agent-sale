import {
  BrainSignalsUpdatedPayload,
  MessageReceivedPayload,
  OrderCreatedV1,
  OrderStatusChangedV1,
  ReplyCompletedPayload,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { COMMERCE_FACADE, type CommerceFacade } from '../../commerce/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import { LODGING_FACADE, type LodgingFacade } from '../../lodging/api/index.js';
import {
  afterSaleDueAt,
  endsFollowUps,
  type MessageTemplate,
  placeInWindow,
  stepDue,
  templateForStage,
  windowClosesAt,
} from '../domain/care.js';
import {
  CARE_EVENT_SOURCE,
  CARE_STORE,
  type CareEventRow,
  type CareEventSource,
  type CareStore,
} from '../domain/ports/care.store.js';
import { CareSettingsService, type CareTemplates } from './care-settings.service.js';

/** The outbox events the care module reads. */
export const CARE_EVENTS = [
  'conversation.message.received.v1',
  'conversation.reply.completed.v1',
  'brain.signals.updated.v1',
  'commerce.order.created.v1',
  'commerce.order.status_changed.v1',
  'lodging.booking.created.v1',
  'lodging.booking.checked_out.v1',
] as const;
const BATCH = 500;
/** An event older than this when first read starts no cycle (a backlog after an outage). */
export const MAX_ENROLL_AGE_MS = 24 * 3_600_000;
const MESSAGE_TEMPLATES: MessageTemplate[] = ['silent', 'ready'];
const DISTANT = new Date('9999-01-01T00:00:00Z');
const EPOCH = new Date(0);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * The care agent's outbox consumer (spec §7), read like the Brain's (transaction horizon, own
 * checkpoint, exclusive lease):
 * - a customer message stops the conversation's message cycles (and a due after-sales check-in):
 *   the customer replied; the Brain re-evaluates and may start a new cycle;
 * - a member's message (inbox send or Page echo) stops them too (a person took over);
 * - `brain.signals.updated.v1` starts "Khách im lặng" (exploring, price asked) or "Sắp chốt"
 *   (ready) anchored at the last customer message, and stops the other or both (won, lost,
 *   spam, after-sales, opt-out);
 * - an order or stay booking made in the conversation stops the cycles; a delivered order or a
 *   checked-out stay starts the after-sales check-in.
 * Idempotent: a cycle is keyed by conversation, template and anchor.
 */
@Injectable()
export class CareEnroller {
  readonly #log = new Logger(CareEnroller.name);

  constructor(
    @Inject(CARE_EVENT_SOURCE) private readonly events: CareEventSource,
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CareSettingsService) private readonly settings: CareSettingsService,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(COMMERCE_FACADE) @Optional() private readonly commerce?: CommerceFacade,
    @Inject(LODGING_FACADE) @Optional() private readonly lodging?: LodgingFacade,
  ) {}

  /** One pass over the new events; how many were handled (0 when another worker holds it). */
  async pass(now = new Date()): Promise<number> {
    const done = await this.events.withLease(async (lease) => {
      const cache = new Map<string, CareTemplates>();
      let after = 0;
      let handled = 0;
      for (;;) {
        const rows = await lease.readBatch(after, BATCH);
        if (!rows.length) break;
        for (const row of rows) {
          try {
            await this.handle(row, cache, now);
            handled++;
          } catch (e) {
            // One bad event never blocks the others; the step's own checks catch up later.
            this.#log.warn(`care skipped outbox event ${row.id} (${errorClass(e)})`);
          }
        }
        after = rows.reduce((max, r) => Math.max(max, r.id), after);
      }
      await lease.commit();
      return handled;
    });
    return done ?? 0;
  }

  async handle(row: CareEventRow, cache: Map<string, CareTemplates>, now: Date): Promise<void> {
    const ws = row.workspaceId;
    const templates = async () => {
      let t = cache.get(ws);
      if (!t) {
        t = await this.settings.templates(ws);
        cache.set(ws, t);
      }
      return t;
    };
    const fresh = now.getTime() - row.createdAt.getTime() <= MAX_ENROLL_AGE_MS;
    switch (row.type) {
      case 'conversation.message.received.v1': {
        const p = MessageReceivedPayload.safeParse(row.payload);
        if (!p.success) return;
        const reason = p.data.type === 'echo' ? 'member_message' : 'customer_replied';
        await this.store.stopConversation(ws, row.aggregateId, MESSAGE_TEMPLATES, reason, now);
        await this.store.stopConversation(ws, row.aggregateId, ['after_sale'], reason, now, now);
        return;
      }
      case 'conversation.reply.completed.v1': {
        const p = ReplyCompletedPayload.safeParse(row.payload);
        if (!p.success || p.data.sender !== 'human' || p.data.status !== 'sent') return;
        await this.store.stopConversation(
          ws,
          row.aggregateId,
          MESSAGE_TEMPLATES,
          'member_message',
          now,
        );
        await this.store.stopConversation(
          ws,
          row.aggregateId,
          ['after_sale'],
          'member_message',
          now,
          now,
        );
        return;
      }
      case 'brain.signals.updated.v1': {
        const p = BrainSignalsUpdatedPayload.safeParse(row.payload);
        if (!p.success) return;
        await this.#onSignal(ws, p.data, await templates(), fresh, now);
        return;
      }
      case 'commerce.order.created.v1':
      case 'lodging.booking.created.v1': {
        const conv = await this.#saleConversation(ws, row);
        if (conv) await this.store.stopConversation(ws, conv, MESSAGE_TEMPLATES, 'ordered', now);
        return;
      }
      case 'commerce.order.status_changed.v1':
      case 'lodging.booking.checked_out.v1': {
        if (row.type === 'commerce.order.status_changed.v1') {
          const p = OrderStatusChangedV1.omit({ type: true }).safeParse(row.payload);
          if (!p.success || p.data.toStatus !== 'delivered') return;
        }
        const t = (await templates()).after_sale;
        if (!t.enabled || !fresh) return;
        const conv = await this.#saleConversation(ws, row);
        if (!conv) return;
        const completedAt = occurredAt(row);
        await this.store.enroll(
          ws,
          {
            conversationId: conv,
            template: 'after_sale',
            anchorAt: completedAt,
            nextAt: afterSaleDueAt(completedAt, t.afterSaleDays),
          },
          now,
        );
        return;
      }
      default:
        return;
    }
  }

  async #onSignal(
    ws: WorkspaceId,
    p: BrainSignalsUpdatedPayload,
    templates: CareTemplates,
    fresh: boolean,
    now: Date,
  ): Promise<void> {
    const conv = p.conversationId;
    if (p.optOut) {
      await this.store.stopConversation(ws, conv, MESSAGE_TEMPLATES, 'opted_out', now);
      return;
    }
    if (endsFollowUps(p.stage)) {
      await this.store.stopConversation(ws, conv, MESSAGE_TEMPLATES, 'stage_changed', now);
      return;
    }
    const template = templateForStage(p.stage);
    if (!template) return;
    const other: MessageTemplate = template === 'silent' ? 'ready' : 'silent';
    await this.store.stopConversation(ws, conv, [other], 'stage_changed', now);
    if (!templates[template].enabled || !fresh) return;
    // The signal itself is read again at each step; here only the anchor and the window.
    const facts = await this.conversations.followUpFacts(ws, conv);
    if (!facts || facts.status !== 'open' || !facts.lastInboundAt) return;
    const closes = windowClosesAt(facts.provider, facts.lastInboundAt);
    if (!closes) return;
    const anchor = new Date(facts.lastInboundAt);
    const due = stepDue(template, 0, anchor);
    const at = due ? placeInWindow(due, closes) : null;
    if (!at) return;
    await this.store.enroll(
      ws,
      { conversationId: conv, template, anchorAt: anchor, nextAt: at },
      now,
    );
  }

  /** The conversation of the order or stay booking of the event; null when it has none. */
  async #saleConversation(ws: WorkspaceId, row: CareEventRow): Promise<string | null> {
    const id = (row.payload as { orderId?: unknown; bookingId?: unknown } | null) ?? {};
    if (row.type.startsWith('commerce.')) {
      const orderId = typeof id.orderId === 'string' ? id.orderId : row.aggregateId;
      const [o] =
        (await this.commerce?.conversationOrders(ws, {
          since: EPOCH,
          until: DISTANT,
          orderIds: [orderId],
        })) ?? [];
      return o?.conversationId ?? null;
    }
    const bookingId = typeof id.bookingId === 'string' ? id.bookingId : row.aggregateId;
    const [b] =
      (await this.lodging?.conversationBookings(ws, {
        since: EPOCH,
        until: DISTANT,
        bookingIds: [bookingId],
      })) ?? [];
    return b?.conversationId ?? null;
  }
}

/** When the event happened: the payload's `occurredAt`, else when it was written. */
function occurredAt(row: CareEventRow): Date {
  const p = OrderCreatedV1.pick({ occurredAt: true }).safeParse(row.payload);
  return p.success ? new Date(p.data.occurredAt) : row.createdAt;
}
