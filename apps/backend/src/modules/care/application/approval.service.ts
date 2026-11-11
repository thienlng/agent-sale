import type {
  AiDoneResponse,
  BulkApproveCareMessagesResponse,
  CareMessageDto,
  CareMessageStatus,
  ConversationSignalDto,
  TodayApprovalItem,
} from '@agent-sales/contracts';
import { isUuid, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BRAIN_FACADE, type BrainFacade, type TodayViewerRef } from '../../brain/api/index.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
  type TodayConversation,
} from '../../conversation/api/index.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { draftExpired, hcmDayStart } from '../domain/care.js';
import {
  CareMessageNotFoundError,
  CareMessageNotPendingError,
  CareWindowClosedError,
} from '../domain/care.errors.js';
import { CARE_STORE, type CareMessage, type CareStore } from '../domain/ports/care.store.js';
import { CareSender } from './care-sender.js';

/** Drafts read for one Today (the newest; a busy shop's queue). */
const DRAFTS_READ = 500;
/** "Gửi tất cả" sends at most this many at once. */
export const BULK_MAX = 50;
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
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BRAIN_FACADE) private readonly brain: BrainFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  /** The viewer's drafts still inside their window: the count and up to `limit` items. */
  async approvals(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    now: Date,
    limit: number,
  ): Promise<{ count: number; items: TodayApprovalItem[] }> {
    const drafts = (await this.store.drafts(ws, DRAFTS_READ)).filter(
      (d) => !draftExpired(d.windowClosesAt, now),
    );
    if (!drafts.length) return { count: 0, items: [] };
    const facts = await this.#facts(
      ws,
      drafts.map((d) => d.conversationId),
      viewer,
    );
    const visible = drafts.filter((d) => facts.has(d.conversationId));
    const shown = visible.slice(0, Math.max(0, limit));
    if (!shown.length) return { count: visible.length, items: [] };
    const [signals, names] = await Promise.all([
      this.#signals(
        ws,
        shown.map((d) => d.conversationId),
      ),
      this.#names(shown.map((d) => facts.get(d.conversationId)?.assigneeId ?? null)),
    ]);
    return {
      count: visible.length,
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
            createdAt: d.createdAt.toISOString(),
          },
        ];
      }),
    };
  }

  /**
   * Sends a draft now (with the edited text when given). NOT_FOUND when it is not the viewer's to
   * see; CONFLICT when it was decided already, or the window closed or the conversation changed
   * (then it is `expired` / `failed`). A channel failure is an answer (`failed`), not an error.
   */
  async approve(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    id: string,
    text: string | undefined,
    now = new Date(),
  ): Promise<CareMessageDto> {
    const m = await this.#visible(ws, viewer, id);
    if (m.status !== 'draft') throw new CareMessageNotPendingError(id, m.status);
    // Takes the draft only while its window is open (a closed one becomes `expired`).
    const claimed = await this.store.claimDraft(ws, id, viewer.userId, now);
    if (!claimed) {
      const again = await this.store.getMessage(ws, id);
      if (again?.status === 'expired') throw new CareWindowClosedError(id);
      throw new CareMessageNotPendingError(id, again?.status ?? 'unknown');
    }
    const out = await this.sender.send(
      ws,
      { id, conversationId: m.conversationId, text: text ?? m.text },
      viewer.userId,
      now,
    );
    if (out.status === 'failed' && out.reason === 'conversation_changed') {
      throw new CareWindowClosedError(id);
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

  /** "Gửi tất cả": the given drafts (or every draft the viewer sees), at most 50, one by one. */
  async approveAll(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    ids: readonly string[] | undefined,
    now = new Date(),
  ): Promise<BulkApproveCareMessagesResponse> {
    const wanted = ids?.length
      ? [...new Set(ids)].slice(0, BULK_MAX)
      : (await this.approvals(ws, viewer, now, BULK_MAX)).items.map((i) => i.careMessageId);
    const results: { id: string; status: CareMessageStatus }[] = [];
    for (const id of wanted) {
      try {
        results.push({ id, status: (await this.approve(ws, viewer, id, undefined, now)).status });
      } catch {
        const m = isUuid(id) ? await this.store.getMessage(ws, id) : null;
        // An id the viewer may not see is reported like a missing one: no detail leaks.
        const visible = m && (await this.#facts(ws, [m.conversationId], viewer)).size > 0;
        results.push({ id, status: visible && m ? m.status : 'failed' });
      }
    }
    const sent = results.filter((r) => r.status === 'sent').length;
    return { sent, notSent: results.length - sent, results };
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
