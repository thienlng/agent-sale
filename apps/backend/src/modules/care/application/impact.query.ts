import type { ImpactRange, ImpactResponse } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { COMMERCE_FACADE, type CommerceFacade } from '../../commerce/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import { LODGING_FACADE, type LodgingFacade } from '../../lodging/api/index.js';
import {
  ATTRIBUTION_WINDOW_MS,
  type Attribution,
  attributionOf,
  rangeStart,
  type Sale,
  summarize,
} from '../domain/attribution.js';
import { CARE_STORE, type CareStore } from '../domain/ports/care.store.js';

const IDS_PER_READ = 1000;
const SENT_READ = 5000;
const EPOCH = new Date(0);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * "Rapiz đã mang lại" (spec §6): over the range, the follow-ups the care agent sent and how many
 * customers wrote after them, and the orders (commerce) and stay bookings (lodging) made in a
 * conversation within 7 days after an AI touch — a bot reply or a care message — attributed to
 * the AI alone or to AI + staff (a member wrote in between). A query over `care_messages`, the
 * conversations' delivered messages (aggregated per sale in SQL: nothing is truncated) and the
 * commerce/lodging facades; no event pipeline.
 */
@Injectable()
export class ImpactQuery {
  readonly #log = new Logger(ImpactQuery.name);

  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(COMMERCE_FACADE) @Optional() private readonly commerce?: CommerceFacade,
    @Inject(LODGING_FACADE) @Optional() private readonly lodging?: LodgingFacade,
  ) {}

  async impact(ws: WorkspaceId, range: ImpactRange, now = new Date()): Promise<ImpactResponse> {
    const since = rangeStart(range, now);
    const until = new Date(now.getTime() + 1);
    const [sent, sales] = await Promise.all([
      this.store.sentBetween(ws, { since, until, limit: SENT_READ }),
      this.#sales(ws, since, until),
    ]);
    const [replies, attributions] = await Promise.all([
      this.#replies(ws, sent),
      this.#attributions(ws, sales),
    ]);
    const figures = summarize(sales, (_s, i) => attributions[i] ?? null);
    return {
      range,
      since: since.toISOString(),
      until: now.toISOString(),
      followUpsSent: sent.length,
      repliesReceived: replies,
      ...figures,
    };
  }

  /** Orders and stay bookings made in a conversation in the range (a failed read: none). */
  async #sales(ws: WorkspaceId, since: Date, until: Date): Promise<Sale[]> {
    const read = <T>(p: Promise<T[]> | undefined): Promise<T[]> =>
      (p ?? Promise.resolve([])).catch((e: unknown) => {
        this.#log.warn(`sales of the impact not read (${errorClass(e)})`);
        return [];
      });
    const [orders, bookings] = await Promise.all([
      read(this.commerce?.conversationOrders(ws, { since, until })),
      read(this.lodging?.conversationBookings(ws, { since, until })),
    ]);
    return [...orders, ...bookings].map((s) => ({
      conversationId: s.conversationId,
      createdAt: s.createdAt,
      total: s.total,
    }));
  }

  /**
   * How many customers wrote back after a follow-up of the range: one per conversation (their
   * last message is later than the first follow-up of the range), however many follow-ups it got.
   */
  async #replies(
    ws: WorkspaceId,
    sent: readonly { conversationId: string; sentAt: Date | null }[],
  ): Promise<number> {
    const first = new Map<string, number>();
    for (const m of sent) {
      if (!m.sentAt) continue;
      const t = m.sentAt.getTime();
      first.set(m.conversationId, Math.min(first.get(m.conversationId) ?? t, t));
    }
    const ids = [...first.keys()];
    let replied = 0;
    for (let i = 0; i < ids.length; i += IDS_PER_READ) {
      const rows = await this.conversations.todayCandidates(ws, {
        ids: ids.slice(i, i + IDS_PER_READ),
        awaitingBefore: EPOCH,
        followUpBefore: EPOCH,
        limit: IDS_PER_READ,
        lastHumanFor: [],
      });
      for (const r of rows) {
        const at = first.get(r.id);
        if (r.lastInboundAt && at !== undefined && Date.parse(r.lastInboundAt) > at) replied++;
      }
    }
    return replied;
  }

  /** Each sale's attribution, from the per-sale aggregate of the conversation module. */
  async #attributions(ws: WorkspaceId, sales: readonly Sale[]): Promise<(Attribution | null)[]> {
    const out: (Attribution | null)[] = [];
    for (let i = 0; i < sales.length; i += IDS_PER_READ) {
      const chunk = sales.slice(i, i + IDS_PER_READ);
      const touches = await this.conversations.aiTouches(
        ws,
        chunk.map((s) => ({ conversationId: s.conversationId, at: s.createdAt })),
        ATTRIBUTION_WINDOW_MS,
      );
      out.push(...chunk.map((_s, j) => (touches[j] ? attributionOf(touches[j]) : null)));
    }
    return out;
  }
}
