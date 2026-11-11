import type { AutonomyLevel, CareTemplateKey } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';

import { AFTER_SALE_LISTED_MS, type MessageTemplate, type StopReason } from '../../domain/care.js';
import type {
  CareEventLease,
  CareEventRow,
  CareEventSource,
  CareJob,
  CareMessage,
  CareStore,
  CareTemplateRow,
  NewCareMessage,
} from '../../domain/ports/care.store.js';

interface Enrollment {
  id: string;
  workspaceId: WorkspaceId;
  conversationId: string;
  template: CareTemplateKey;
  step: number;
  anchorAt: Date;
  nextAt: Date;
  status: 'active' | 'done' | 'stopped';
  stopReason: string | null;
  leaseUntil: Date | null;
  attempts: number;
}

type Stored = CareMessage & { workspaceId: WorkspaceId; updatedAt: Date };

/** In-memory `CareStore` with the same rules as the Drizzle one (tests only). */
export class MemoryCareStore implements CareStore {
  templateRows = new Map<string, CareTemplateRow>();
  usage = new Map<string, number>();
  enrollments: Enrollment[] = [];
  messages: Stored[] = [];
  audits: { workspaceId: string; action: string; targetId: string; actor: string | null }[] = [];

  templates(ws: WorkspaceId) {
    return Promise.resolve(
      [...this.templateRows].filter(([k]) => k.startsWith(`${ws}/`)).map(([, r]) => ({ ...r })),
    );
  }
  putTemplate(ws: WorkspaceId, row: CareTemplateRow, now: Date) {
    this.templateRows.set(`${ws}/${row.key}`, { ...row });
    if (!row.enabled) {
      for (const e of this.enrollments)
        if (e.workspaceId === ws && e.template === row.key && e.status === 'active') {
          e.status = 'stopped';
          e.stopReason = 'template_off';
          this.#expireDrafts(ws, e.conversationId, now);
        }
    }
    return Promise.resolve();
  }
  reserveUsage(ws: WorkspaceId, day: string, limit: number | null) {
    if (limit !== null && limit <= 0) return Promise.resolve(false);
    const k = `${ws}/${day}`;
    const n = this.usage.get(k) ?? 0;
    if (limit !== null && n >= limit) return Promise.resolve(false);
    this.usage.set(k, n + 1);
    return Promise.resolve(true);
  }
  releaseUsage(ws: WorkspaceId, day: string) {
    const k = `${ws}/${day}`;
    this.usage.set(k, Math.max(0, (this.usage.get(k) ?? 0) - 1));
    return Promise.resolve();
  }
  usedOn(ws: WorkspaceId, day: string) {
    return Promise.resolve(this.usage.get(`${ws}/${day}`) ?? 0);
  }
  enroll(
    ws: WorkspaceId,
    e: { conversationId: string; template: CareTemplateKey; anchorAt: Date; nextAt: Date },
  ) {
    const found = this.enrollments.find(
      (x) =>
        x.workspaceId === ws && x.conversationId === e.conversationId && x.template === e.template,
    );
    if (found) {
      if (found.anchorAt.getTime() >= e.anchorAt.getTime()) return Promise.resolve(false);
      Object.assign(found, {
        step: 0,
        anchorAt: e.anchorAt,
        nextAt: e.nextAt,
        status: 'active',
        stopReason: null,
        leaseUntil: null,
        attempts: 0,
      });
      return Promise.resolve(true);
    }
    this.enrollments.push({
      id: newId(),
      workspaceId: ws,
      ...e,
      step: 0,
      status: 'active',
      stopReason: null,
      leaseUntil: null,
      attempts: 0,
    });
    return Promise.resolve(true);
  }
  stopConversation(
    ws: WorkspaceId,
    conversationId: string,
    templates: readonly CareTemplateKey[],
    reason: StopReason,
    now: Date,
    onlyDueBy?: Date,
  ) {
    let n = 0;
    for (const e of this.enrollments) {
      if (e.workspaceId !== ws || e.conversationId !== conversationId || e.status !== 'active')
        continue;
      if (!templates.includes(e.template)) continue;
      if (onlyDueBy && e.nextAt.getTime() > onlyDueBy.getTime()) continue;
      e.status = 'stopped';
      e.stopReason = reason;
      n++;
    }
    if (templates.some((t) => t !== 'after_sale')) this.#expireDrafts(ws, conversationId, now);
    return Promise.resolve(n);
  }
  claimDue(now: Date, limit: number, leaseMs: number): Promise<CareJob[]> {
    const due = this.enrollments
      .filter(
        (e) =>
          e.status === 'active' &&
          e.template !== 'after_sale' &&
          e.nextAt.getTime() <= now.getTime() &&
          (!e.leaseUntil || e.leaseUntil.getTime() <= now.getTime()),
      )
      .sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime())
      .slice(0, limit);
    for (const e of due) {
      e.leaseUntil = new Date(now.getTime() + leaseMs);
      e.attempts += 1;
    }
    return Promise.resolve(
      due.map((e) => ({
        id: e.id,
        workspaceId: e.workspaceId,
        conversationId: e.conversationId,
        template: e.template as MessageTemplate,
        step: e.step,
        anchorAt: e.anchorAt,
        nextAt: e.nextAt,
        attempts: e.attempts,
      })),
    );
  }
  #find(ws: WorkspaceId, id: string) {
    return this.enrollments.find(
      (e) => e.workspaceId === ws && e.id === id && e.status === 'active',
    );
  }
  advance(ws: WorkspaceId, id: string, step: number, nextAt: Date) {
    const e = this.#find(ws, id);
    if (e) Object.assign(e, { step, nextAt, leaseUntil: null, attempts: 0 });
    return Promise.resolve();
  }
  finish(ws: WorkspaceId, id: string) {
    const e = this.#find(ws, id);
    if (e) Object.assign(e, { status: 'done', leaseUntil: null });
    return Promise.resolve();
  }
  stop(ws: WorkspaceId, id: string, reason: StopReason, now: Date) {
    const e = this.#find(ws, id);
    if (e) {
      Object.assign(e, { status: 'stopped', stopReason: reason, leaseUntil: null });
      this.#expireDrafts(ws, e.conversationId, now);
    }
    return Promise.resolve();
  }
  reschedule(ws: WorkspaceId, id: string, at: Date, resetAttempts: boolean) {
    const e = this.#find(ws, id);
    if (e)
      Object.assign(e, { nextAt: at, leaseUntil: null, ...(resetAttempts ? { attempts: 0 } : {}) });
    return Promise.resolve();
  }
  afterSaleDue(ws: WorkspaceId, before: Date, now: Date) {
    return Promise.resolve(
      this.enrollments
        .filter(
          (e) =>
            e.workspaceId === ws &&
            e.status === 'active' &&
            e.template === 'after_sale' &&
            e.nextAt.getTime() < before.getTime() &&
            e.nextAt.getTime() >= now.getTime() - AFTER_SALE_LISTED_MS,
        )
        .map((e) => e.conversationId),
    );
  }
  #expireDrafts(ws: WorkspaceId, conversationId: string, now: Date) {
    for (const m of this.messages)
      if (
        m.workspaceId === ws &&
        m.conversationId === conversationId &&
        (m.status === 'draft' || m.status === 'scheduled')
      ) {
        m.status = 'expired';
        m.updatedAt = now;
      }
  }
  /** Test hook: runs just before a step's message is written (a race lands here). */
  beforeInsert: (() => Promise<void> | void) | null = null;
  async insertMessage(ws: WorkspaceId, m: NewCareMessage) {
    await this.beforeInsert?.();
    if (
      m.enrollmentId &&
      this.messages.some(
        (x) =>
          x.workspaceId === ws &&
          x.enrollmentId === m.enrollmentId &&
          x.anchorAt.getTime() === m.anchorAt.getTime() &&
          x.step === m.step,
      )
    )
      return false;
    if (m.status === 'draft')
      for (const x of this.messages)
        if (x.workspaceId === ws && x.conversationId === m.conversationId && x.status === 'draft') {
          x.status = 'expired';
          x.updatedAt = m.createdAt;
        }
    this.messages.push({
      id: m.id,
      workspaceId: ws,
      conversationId: m.conversationId,
      enrollmentId: m.enrollmentId,
      anchorAt: m.anchorAt,
      template: m.template,
      step: m.step,
      level: m.level,
      text: m.text,
      status: m.status,
      skipReason: m.skipReason,
      windowClosesAt: m.windowClosesAt,
      scheduledFor: null,
      sentMessageId: null,
      sentAt: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: m.createdAt,
      updatedAt: m.createdAt,
    });
    this.audits.push({
      workspaceId: ws,
      action: `care.message.${m.status}`,
      targetId: m.id,
      actor: null,
    });
    return true;
  }
  stepMessage(ws: WorkspaceId, enrollmentId: string, anchorAt: Date, step: number) {
    const m = this.messages.find(
      (x) =>
        x.workspaceId === ws &&
        x.enrollmentId === enrollmentId &&
        x.anchorAt.getTime() === anchorAt.getTime() &&
        x.step === step,
    );
    return Promise.resolve(m ? { ...m } : null);
  }
  #get(ws: WorkspaceId, id: string) {
    return this.messages.find((m) => m.workspaceId === ws && m.id === id);
  }
  getMessage(ws: WorkspaceId, id: string): Promise<CareMessage | null> {
    const m = this.#get(ws, id);
    return Promise.resolve(m ? { ...m } : null);
  }
  messagesOf(ws: WorkspaceId, conversationId: string, limit: number) {
    return Promise.resolve(
      this.messages
        .filter((m) => m.workspaceId === ws && m.conversationId === conversationId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((m) => ({ ...m })),
    );
  }
  drafts(ws: WorkspaceId, limit: number) {
    return Promise.resolve(
      this.messages
        .filter((m) => m.workspaceId === ws && m.status === 'draft')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((m) => ({ ...m })),
    );
  }
  scheduled(ws: WorkspaceId, limit: number) {
    return Promise.resolve(
      this.messages
        .filter((m) => m.workspaceId === ws && m.status === 'scheduled')
        .sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0))
        .slice(0, limit)
        .map((m) => ({ ...m })),
    );
  }
  claimDraft(
    ws: WorkspaceId,
    id: string,
    by: string,
    now: Date,
    opts: { text?: string | undefined; sendAt?: Date | undefined } = {},
  ) {
    const m = this.#get(ws, id);
    if (!m || m.status !== 'draft') return Promise.resolve(null);
    if (m.windowClosesAt && m.windowClosesAt.getTime() <= now.getTime()) {
      m.status = 'expired';
      return Promise.resolve(null);
    }
    const later = opts.sendAt !== undefined;
    Object.assign(m, {
      status: later ? 'scheduled' : 'sending',
      scheduledFor: later ? (opts.sendAt ?? null) : null,
      ...(opts.text !== undefined ? { text: opts.text } : {}),
      decidedBy: by,
      decidedAt: now,
      updatedAt: now,
    });
    if (later)
      this.audits.push({
        workspaceId: ws,
        action: 'care.message.scheduled',
        targetId: id,
        actor: by,
      });
    return Promise.resolve({ ...m });
  }
  dueScheduled(now: Date, limit: number) {
    return Promise.resolve(
      this.messages
        .filter(
          (m) =>
            m.status === 'scheduled' &&
            m.scheduledFor !== null &&
            m.scheduledFor.getTime() <= now.getTime(),
        )
        .sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0))
        .slice(0, limit)
        .map((m) => ({ workspaceId: m.workspaceId, id: m.id })),
    );
  }
  claimScheduled(ws: WorkspaceId, id: string, now: Date) {
    const m = this.#get(ws, id);
    if (
      !m ||
      m.status !== 'scheduled' ||
      !m.scheduledFor ||
      m.scheduledFor.getTime() > now.getTime()
    )
      return Promise.resolve(null);
    Object.assign(m, { status: 'sending', updatedAt: now });
    return Promise.resolve({ ...m });
  }
  deferScheduled(ws: WorkspaceId, id: string, at: Date, now: Date) {
    const m = this.#get(ws, id);
    if (m?.status === 'scheduled') Object.assign(m, { scheduledFor: at, updatedAt: now });
    return Promise.resolve();
  }
  expireMessage(ws: WorkspaceId, id: string, reason: string, now: Date) {
    const m = this.#get(ws, id);
    if (!m || (m.status !== 'draft' && m.status !== 'scheduled')) return Promise.resolve(false);
    Object.assign(m, { status: 'expired', skipReason: reason, updatedAt: now });
    this.audits.push({
      workspaceId: ws,
      action: 'care.message.expired',
      targetId: id,
      actor: null,
    });
    return Promise.resolve(true);
  }
  finishSend(
    ws: WorkspaceId,
    id: string,
    r: {
      status: 'sent' | 'failed' | 'expired';
      text: string;
      sentMessageId: string | null;
      reason: string | null;
      actor: string | null;
    },
    now: Date,
  ) {
    const m = this.#get(ws, id);
    if (m?.status === 'sending') {
      Object.assign(m, {
        status: r.status,
        text: r.text,
        sentMessageId: r.sentMessageId,
        sentAt: r.status === 'sent' ? now : null,
        skipReason: r.reason,
        updatedAt: now,
      });
      this.audits.push({
        workspaceId: ws,
        action: `care.message.${r.status}`,
        targetId: id,
        actor: r.actor,
      });
    }
    return Promise.resolve();
  }
  rejectDraft(ws: WorkspaceId, id: string, by: string, now: Date) {
    const m = this.#get(ws, id);
    if (!m || m.status !== 'draft') return Promise.resolve(false);
    Object.assign(m, { status: 'rejected', decidedBy: by, decidedAt: now });
    return Promise.resolve(true);
  }
  sentTimes(ws: WorkspaceId, conversationId: string, since: Date, exceptId?: string) {
    return Promise.resolve(
      this.messages
        .filter(
          (m) =>
            m.workspaceId === ws &&
            m.conversationId === conversationId &&
            m.id !== exceptId &&
            (m.status === 'sent' ||
              m.status === 'sending' ||
              m.status === 'scheduled' ||
              (m.status === 'failed' && m.skipReason === 'interrupted')),
        )
        .map((m) => m.sentAt ?? m.scheduledFor ?? m.updatedAt)
        .filter((t) => t.getTime() >= since.getTime()),
    );
  }
  sentBetween(
    ws: WorkspaceId,
    q: { since: Date; until: Date; level?: AutonomyLevel; limit: number },
  ) {
    return Promise.resolve(
      this.messages
        .filter(
          (m) =>
            m.workspaceId === ws &&
            m.status === 'sent' &&
            m.sentAt !== null &&
            m.sentAt.getTime() >= q.since.getTime() &&
            m.sentAt.getTime() < q.until.getTime() &&
            (!q.level || m.level === q.level),
        )
        .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))
        .slice(0, q.limit)
        .map((m) => ({ ...m })),
    );
  }
  expireDue(now: Date, staleBefore: Date) {
    let n = 0;
    for (const m of this.messages) {
      if (
        (m.status === 'draft' || m.status === 'scheduled') &&
        m.windowClosesAt &&
        m.windowClosesAt.getTime() <= now.getTime()
      ) {
        m.status = 'expired';
        n++;
      } else if (m.status === 'sending' && m.updatedAt.getTime() <= staleBefore.getTime()) {
        m.status = 'failed';
        m.skipReason = 'interrupted';
        n++;
      }
    }
    for (const e of this.enrollments)
      if (
        e.status === 'active' &&
        e.template === 'after_sale' &&
        e.nextAt.getTime() < now.getTime() - AFTER_SALE_LISTED_MS
      ) {
        e.status = 'done';
        n++;
      }
    return Promise.resolve(n);
  }
}

/** Outbox events handed to the enroller by the test. */
export class MemoryCareEvents implements CareEventSource {
  rows: CareEventRow[] = [];
  #committed = 0;
  push(row: Omit<CareEventRow, 'id'>) {
    this.rows.push({ ...row, id: this.rows.length + 1 });
  }
  withLease<T>(fn: (lease: CareEventLease) => Promise<T>): Promise<T | null> {
    const from = this.#committed;
    const snapshot = this.rows.filter((r) => r.id > from);
    return fn({
      readBatch: (afterId, limit) =>
        Promise.resolve(snapshot.filter((r) => r.id > afterId).slice(0, limit)),
      commit: () => {
        this.#committed = this.rows.length;
        return Promise.resolve();
      },
    });
  }
}
