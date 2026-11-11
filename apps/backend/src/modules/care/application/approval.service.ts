import type {
  AiDoneResponse,
  BulkApproveCareMessagesResponse,
  CareMessageDto,
  CareMessageStatus,
  ConversationSignalDto,
  TodayApprovalItem,
} from '@agent-sales/contracts';
import { type DomainError, isUuid, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BRAIN_FACADE, type BrainFacade, type TodayViewerRef } from '../../brain/api/index.js';
import {
  type CareRefusal,
  CONVERSATION_FACADE,
  type ConversationFacade,
  type TodayConversation,
} from '../../conversation/api/index.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  draftExpired,
  hcmDayStart,
  inQuietHours,
  type MessageTemplate,
  nextAllowedAfterLimit,
  placeInWindow,
  quietHoursEnd,
  type StopReason,
} from '../domain/care.js';
import {
  CareCustomerRepliedError,
  CareLimitReachedError,
  CareMessageNotFoundError,
  CareMessageNotPendingError,
  CareStoppedError,
  CareTakenOverError,
  CareWindowClosedError,
} from '../domain/care.errors.js';
import { CARE_STORE, type CareMessage, type CareStore } from '../domain/ports/care.store.js';
import { CareGuard } from './care-guard.js';
import { CareSender } from './care-sender.js';

/** Drafts read for one Today (the newest; a busy shop's queue). */
const DRAFTS_READ = 500;
/** "Gửi tất cả" approves at most this many at once… */
export const BULK_MAX = 50;
/** …and sends this many in the request; the rest are `scheduled` for the worker's next tick. */
export const BULK_SEND_NOW = 5;
const DAY_MS = 86_400_000;

/** The refusal shown to the member for a stop rule or a refused send (409, module code). */
export function refusalError(id: string, reason: StopReason | CareRefusal): DomainError {
  if (reason === 'taken_over') return new CareTakenOverError(id);
  if (reason === 'customer_replied') return new CareCustomerRepliedError(id);
  if (reason === 'window_closed') return new CareWindowClosedError(id);
  return new CareStoppedError(id, reason === 'conversation_closed' ? 'closed' : reason);
}
const AI_DONE_MAX = 50;
const EPOCH = new Date(0);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toCareMessageDto(m: CareMessage): CareMessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    template: m.template,
    step: m.step,
    level: m.level,
    text: m.text,
    status: m.status,
    skipReason: m.skipReason,
    windowClosesAt: iso(m.windowClosesAt),
    scheduledFor: iso(m.scheduledFor),
    sentMessageId: m.sentMessageId,
    sentAt: iso(m.sentAt),
    decidedBy: m.decidedBy,
    decidedAt: iso(m.decidedAt),
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * "Chờ duyệt" (spec §5, level `suggest`): the drafts on Today, sent by a person ("Gửi", "Sửa rồi
 * gửi", "Gửi tất cả") while the window is open, or dropped ("Bỏ"); and "AI đã làm" (level
 * `act_and_report`): what the AI sent today and whether the customer wrote back. Sales and care
 * see their own and unassigned customers' drafts only.
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CareSender) private readonly sender: CareSender,
    @Inject(CareGuard) private readonly guard: CareGuard,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BRAIN_FACADE) private readonly brain: BrainFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  /**
   * The viewer's drafts still inside their window (`count`: they wait for a person), then their
   * approved messages waiting for their time ("Sẽ gửi lúc 08:00"): up to `limit` items.
   */
  async approvals(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    now: Date,
    limit: number,
  ): Promise<{ count: number; items: TodayApprovalItem[] }> {
    const [allDrafts, scheduled] = await Promise.all([
      this.store.drafts(ws, DRAFTS_READ),
      this.store.scheduled(ws, DRAFTS_READ),
    ]);
    const drafts = allDrafts.filter((d) => !draftExpired(d.windowClosesAt, now));
    const open = [...drafts, ...scheduled.filter((d) => !draftExpired(d.windowClosesAt, now))];
    if (!open.length) return { count: 0, items: [] };
    const facts = await this.#facts(
      ws,
      open.map((d) => d.conversationId),
      viewer,
    );
    const count = drafts.filter((d) => facts.has(d.conversationId)).length;
    const shown = open.filter((d) => facts.has(d.conversationId)).slice(0, Math.max(0, limit));
    if (!shown.length) return { count, items: [] };
    const [signals, names] = await Promise.all([
      this.#signals(
        ws,
        shown.map((d) => d.conversationId),
      ),
      this.#names(shown.map((d) => facts.get(d.conversationId)?.assigneeId ?? null)),
    ]);
    return {
      count,
      items: shown.flatMap((d) => {
        const f = facts.get(d.conversationId);
        if (!f) return [];
        const s = signals.get(d.conversationId);
        return [
          {
            conversationId: f.id,
            contactId: f.contactId,
            customerName: f.customerName,
            avatarUrl: f.customerAvatarUrl,
            channel: f.provider,
            reason: s?.intent ?? '',
            stage: s?.stage ?? 'new',
            mood: s?.mood ?? 'neutral',
            at: d.createdAt.toISOString(),
            assigneeId: f.assigneeId,
            assigneeName: f.assigneeId ? (names.get(f.assigneeId) ?? null) : null,
            stageLocked: s?.stageLocked ?? false,
            careMessageId: d.id,
            template: d.template,
            text: d.text,
            windowClosesAt: iso(d.windowClosesAt),
            scheduledFor: d.status === 'scheduled' ? iso(d.scheduledFor) : null,
            createdAt: d.createdAt.toISOString(),
          },
        ];
      }),
    };
  }

  /**
   * A person approves a draft (with the edited text when given). The stop rules are read again
   * first (a lost outbox event never turns into a wrong send): when one applies — the customer
   * wrote, a person holds the conversation (ADR-031 §7), opted out, ordered, closed… — the draft
   * expires and the answer is 409 with a module code. Then:
   * - in the quiet hours (21:00–08:00) it is `scheduled` for 08:00 local, sent then by the worker
   *   if the window is still open and the rules still pass (else `expired`); refused when 08:00
   *   is already past the window;
   * - the per-conversation limit (2 per 24 hours) applies to approved messages too: 409
   *   `CARE_LIMIT_REACHED`, the draft stays to approve later;
   * - `queue` ("Gửi tất cả" past the first few): `scheduled` now, for the worker's next tick;
   * - else it is sent now. A channel failure is an answer (`failed`), not an error; a send the
   *   conversation refused expires the draft and answers 409.
   * NOT_FOUND when it is not the viewer's to see; `CARE_DRAFT_DECIDED` when already decided.
   */
  async approve(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    id: string,
    text: string | undefined,
    now = new Date(),
    opts: { queue?: boolean } = {},
  ): Promise<CareMessageDto> {
    const m = await this.#visible(ws, viewer, id);
    if (m.status !== 'draft') throw new CareMessageNotPendingError(id, m.status);
    if (draftExpired(m.windowClosesAt, now)) {
      await this.store.expireMessage(ws, id, 'window_closed', now);
      throw new CareWindowClosedError(id);
    }
    const g = await this.guard.check(ws, {
      conversationId: m.conversationId,
      template: m.template as MessageTemplate,
      anchorAt: m.anchorAt,
    });
    if (g.reason) {
      await this.store.expireMessage(ws, id, g.reason, now);
      throw refusalError(id, g.reason);
    }
    const quiet = inQuietHours(now);
    const sendAt = quiet ? quietHoursEnd(now) : now;
    if (quiet && m.windowClosesAt && !placeInWindow(sendAt, m.windowClosesAt)) {
      await this.store.expireMessage(ws, id, 'window_closed', now);
      throw new CareWindowClosedError(id);
    }
    const recent = await this.store.sentTimes(
      ws,
      m.conversationId,
      new Date(sendAt.getTime() - DAY_MS),
    );
    const allowedAt = nextAllowedAfterLimit(recent, sendAt);
    if (allowedAt) throw new CareLimitReachedError(id, allowedAt);
    const schedule = quiet || opts.queue === true;
    const claimed = await this.store.claimDraft(ws, id, viewer.userId, now, {
      text,
      sendAt: schedule ? sendAt : undefined,
    });
    if (!claimed) {
      const again = await this.store.getMessage(ws, id);
      if (again?.status === 'expired') throw new CareWindowClosedError(id);
      throw new CareMessageNotPendingError(id, again?.status ?? 'unknown');
    }
    if (claimed.status === 'sending') {
      const out = await this.sender.send(ws, claimed, viewer.userId, now);
      if (out.status === 'failed' && out.reason !== 'channel_failed') {
        throw refusalError(id, out.reason);
      }
    }
    const stored = await this.store.getMessage(ws, id);
    if (!stored) throw new CareMessageNotFoundError(id);
    return toCareMessageDto(stored);
  }

  /** "Bỏ": the draft is dropped. Same NOT_FOUND / CONFLICT rules. */
  async reject(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    id: string,
    now = new Date(),
  ): Promise<CareMessageDto> {
    const m = await this.#visible(ws, viewer, id);
    if (m.status !== 'draft' || !(await this.store.rejectDraft(ws, id, viewer.userId, now))) {
      throw new CareMessageNotPendingError(id, m.status);
    }
    const stored = await this.store.getMessage(ws, id);
    if (!stored) throw new CareMessageNotFoundError(id);
    return toCareMessageDto(stored);
  }

  /**
   * "Gửi tất cả": the given drafts (or every draft the viewer sees), at most 50, each approved
   * like one "Gửi". Only the first `BULK_SEND_NOW` are sent in the request (each send waits on
   * Meta); the others are `scheduled` for the worker's next tick (or 08:00 in the quiet hours).
   */
  async approveAll(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    ids: readonly string[] | undefined,
    now = new Date(),
  ): Promise<BulkApproveCareMessagesResponse> {
    const wanted = ids?.length
      ? [...new Set(ids)].slice(0, BULK_MAX)
      : (await this.approvals(ws, viewer, now, BULK_MAX)).items
          .filter((i) => i.scheduledFor === null)
          .map((i) => i.careMessageId);
    const results: { id: string; status: CareMessageStatus }[] = [];
    let attempted = 0;
    for (const id of wanted) {
      try {
        const dto = await this.approve(ws, viewer, id, undefined, now, {
          queue: attempted >= BULK_SEND_NOW,
        });
        if (dto.status !== 'scheduled') attempted++;
        results.push({ id, status: dto.status });
      } catch {
        const m = isUuid(id) ? await this.store.getMessage(ws, id) : null;
        // An id the viewer may not see is reported like a missing one: no detail leaks.
        const visible = m && (await this.#facts(ws, [m.conversationId], viewer)).size > 0;
        results.push({ id, status: visible && m ? m.status : 'failed' });
      }
    }
    const sent = results.filter((r) => r.status === 'sent').length;
    const scheduled = results.filter((r) => r.status === 'scheduled').length;
    return { sent, scheduled, notSent: results.length - sent - scheduled, results };
  }

  /**
   * Worker pass: approved messages whose time came (`scheduled`), sent as their approver — if
   * the window is still open and the stop rules still pass (else `expired`), outside the quiet
   * hours, and within the per-conversation limit (else they wait, inside the window).
   */
  async sendScheduled(now: Date, limit = 20): Promise<number> {
    let sent = 0;
    for (const { workspaceId: ws, id } of await this.store.dueScheduled(now, limit)) {
      const m = await this.store.getMessage(ws, id);
      if (!m || m.status !== 'scheduled') continue;
      const closes = m.windowClosesAt;
      const expire = (reason: string) => this.store.expireMessage(ws, id, reason, now);
      if (closes && !placeInWindow(now, closes)) {
        await expire('window_closed');
        continue;
      }
      const g = await this.guard.check(ws, {
        conversationId: m.conversationId,
        template: m.template as MessageTemplate,
        anchorAt: m.anchorAt,
      });
      if (g.reason) {
        await expire(g.reason);
        continue;
      }
      const recent = await this.store.sentTimes(
        ws,
        m.conversationId,
        new Date(now.getTime() - DAY_MS),
        id,
      );
      const wait = inQuietHours(now) ? quietHoursEnd(now) : nextAllowedAfterLimit(recent, now);
      if (wait) {
        const at = closes ? placeInWindow(wait, closes) : wait;
        if (at) await this.store.deferScheduled(ws, id, at, now);
        else await expire('window_closed');
        continue;
      }
      const claimed = await this.store.claimScheduled(ws, id, now);
      if (!claimed) continue;
      const out = await this.sender.send(ws, claimed, claimed.decidedBy, now);
      if (out.status === 'sent') sent++;
    }
    return sent;
  }

  /** "AI đã làm": today's (local day) sends at level `act_and_report` the viewer may see. */
  async aiDone(ws: WorkspaceId, viewer: TodayViewerRef, now = new Date()): Promise<AiDoneResponse> {
    const sent = await this.store.sentBetween(ws, {
      since: hcmDayStart(now),
      until: new Date(now.getTime() + 1),
      level: 'act_and_report',
      limit: 500,
    });
    if (!sent.length) return { count: 0, items: [] };
    const facts = await this.#facts(
      ws,
      sent.map((m) => m.conversationId),
      viewer,
    );
    const visible = sent.filter((m) => facts.has(m.conversationId) && m.sentAt);
    return {
      count: visible.length,
      items: visible.slice(0, AI_DONE_MAX).flatMap((m) => {
        const f = facts.get(m.conversationId);
        if (!f || !m.sentAt) return [];
        const last = f.lastInboundAt ? Date.parse(f.lastInboundAt) : Number.NaN;
        return [
          {
            careMessageId: m.id,
            conversationId: m.conversationId,
            customerName: f.customerName,
            avatarUrl: f.customerAvatarUrl,
            channel: f.provider,
            template: m.template,
            text: m.text,
            sentAt: m.sentAt.toISOString(),
            repliedAt: last > m.sentAt.getTime() ? (f.lastInboundAt ?? null) : null,
          },
        ];
      }),
    };
  }

  async #visible(ws: WorkspaceId, viewer: TodayViewerRef, id: string): Promise<CareMessage> {
    const m = isUuid(id) ? await this.store.getMessage(ws, id) : null;
    if (!m) throw new CareMessageNotFoundError(id);
    if (!(await this.#facts(ws, [m.conversationId], viewer)).has(m.conversationId)) {
      throw new CareMessageNotFoundError(id);
    }
    return m;
  }

  /** The conversations the viewer may see, by id (assigned to them or to nobody, or all). */
  async #facts(
    ws: WorkspaceId,
    ids: readonly string[],
    viewer: TodayViewerRef,
  ): Promise<Map<string, TodayConversation>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.conversations.todayCandidates(ws, {
      ids: unique,
      awaitingBefore: EPOCH,
      followUpBefore: EPOCH,
      limit: 1000,
      visibleTo: viewer.viewAll ? undefined : viewer.userId,
      lastHumanFor: [],
    });
    const wanted = new Set(unique);
    return new Map(rows.filter((r) => wanted.has(r.id)).map((r) => [r.id, r]));
  }

  async #signals(ws: WorkspaceId, ids: readonly string[]) {
    const list: ConversationSignalDto[] = await this.brain.signalsFor(ws, ids).catch(() => []);
    return new Map(list.map((s) => [s.conversationId, s]));
  }

  async #names(ids: readonly (string | null)[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    const names = await Promise.all(
      unique.map((id) => this.identity.displayName(userId(id)).catch(() => null)),
    );
    return new Map(unique.map((id, i) => [id, names[i] ?? null]));
  }
}
