import {
  TODAY_CONVERSATION_QUEUES,
  TODAY_QUEUE_ITEMS_MAX,
  type RefreshTodayResponse,
  type TaskDto,
  type TodayApprovalItem,
  type TodayConversationQueueKey,
  type TodayCounts,
  type TodayItem,
  type TodayResponse,
} from '@agent-sales/contracts';
import { userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { COMMERCE_FACADE, type CommerceFacade } from '../../commerce/api/index.js';
import { LODGING_FACADE, type LodgingFacade } from '../../lodging/api/index.js';

import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { SignalConversationNotFoundError } from '../domain/brain.errors.js';
import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';
import { type ConversationSignal, newAfter } from '../domain/signal.js';
import {
  buildQueues,
  endOfHcmDay,
  type TodayEntry,
  type TodayFacts,
  type TodayViewer,
  orderedSinceSignal,
  PRICE_SILENT_UNTIL_MS,
  READY_WITHIN_MS,
  UNANSWERED_AFTER_MS,
  visibleTo,
} from '../domain/today.js';
import { SettingsService } from './settings.service.js';
import { TodayExtensions } from './today-extensions.js';
import { SignalEvaluator } from './signal-evaluator.js';
import { UsageService } from './usage.service.js';

/** Conversations read for one Today, at most (a busy shop's working set, the viewer's own). */
const CANDIDATES_MAX = 1000;
/** Conversation ids flagged by a signal, read at most (ids only, filtered by the viewer next). */
const SIGNAL_REFS_MAX = 5000;
/** Signals read per query (the store's `signalsFor` bound). */
const SIGNAL_CHUNK = 500;
/** Open tasks read to find the ones due today (overdue first, so the due ones come first). */
const TASKS_READ = 100;
/** `POST /today/refresh`: conversations evaluated per call at most, and side by side. */
export const REFRESH_MAX = 20;
const REFRESH_PARALLEL = 3;
/**
 * `POST /today/refresh` starts no evaluation after this long, so the request ends well within the
 * proxy's read timeout (an evaluation takes up to 20 s); the answer says how many are left.
 */
export const REFRESH_BUDGET_MS = 45_000;

const EPOCH = new Date(0);
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** What one Today read found, before it is shaped for the wire. */
export interface TodaySnapshot {
  queues: Record<TodayConversationQueueKey, TodayEntry[]>;
  taskCount: number;
  tasks: TaskDto[];
  facts: TodayFacts[];
  signals: Map<string, ConversationSignal>;
}

/**
 * The Today screen (spec 2026-11-11 §5): five conversation queues from signals and conversation
 * facts, plus the caller's open tasks due today. A conversation shows in its first matching queue
 * only; sales and care see their own and unassigned customers; a dismissed conversation stays
 * hidden until the customer writes again.
 */
@Injectable()
export class TodayQuery {
  readonly #log = new Logger(TodayQuery.name);

  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(SignalEvaluator) private readonly evaluator: SignalEvaluator,
    @Inject(COMMERCE_FACADE) @Optional() private readonly commerce?: CommerceFacade,
    @Inject(LODGING_FACADE) @Optional() private readonly lodging?: LodgingFacade,
    @Inject(TodayExtensions) @Optional() private readonly extensions?: TodayExtensions,
  ) {}

  /** The care agent's drafts waiting for a person (none without the care module). */
  async #approvals(
    ws: WorkspaceId,
    viewer: TodayViewer,
    now: Date,
    limit: number,
  ): Promise<{ count: number; items: TodayApprovalItem[] }> {
    const care = this.extensions?.care;
    if (!care) return { count: 0, items: [] };
    try {
      return await care.approvals(ws, viewer, now, limit);
    } catch (e) {
      this.#log.warn(`care approvals of Today not read (${errorClass(e)})`);
      return { count: 0, items: [] };
    }
  }

  /** Conversations whose after-sales check-in is due today (none without the care module). */
  async #afterSale(ws: WorkspaceId, now: Date): Promise<Set<string>> {
    const care = this.extensions?.care;
    if (!care) return new Set();
    try {
      return new Set(await care.afterSaleDue(ws, endOfHcmDay(now)));
    } catch (e) {
      this.#log.warn(`after-sale check-ins of Today not read (${errorClass(e)})`);
      return new Set();
    }
  }

  /** The queues as the viewer sees them, with the facts and signals read for them. */
  async #queues(
    ws: WorkspaceId,
    viewer: TodayViewer,
    now: Date,
  ): Promise<Omit<TodaySnapshot, 'taskCount' | 'tasks'>> {
    const [refs, afterSale] = await Promise.all([
      this.store.todaySignalRefs(ws, {
        now,
        readySince: new Date(now.getTime() - READY_WITHIN_MS),
        priceSince: new Date(now.getTime() - PRICE_SILENT_UNTIL_MS),
        limit: SIGNAL_REFS_MAX,
      }),
      this.#afterSale(ws, now),
    ]);
    // The viewer's filter runs in SQL before the cap, and the last staff reply is read only for
    // the conversations it decides (complaint or needs a person).
    const facts = await this.conversations.todayCandidates(ws, {
      ids: [...new Set([...refs.map((r) => r.conversationId), ...afterSale])],
      awaitingBefore: new Date(now.getTime() - UNANSWERED_AFTER_MS),
      followUpBefore: endOfHcmDay(now),
      limit: CANDIDATES_MAX,
      visibleTo: viewer.viewAll ? undefined : viewer.userId,
      lastHumanFor: refs.filter((r) => r.attention).map((r) => r.conversationId),
    });
    const signals = new Map<string, ConversationSignal>();
    await this.#loadSignals(
      ws,
      facts.map((f) => f.id),
      signals,
    );
    const ordered = await this.#ordered(ws, facts, signals);
    return {
      queues: buildQueues(facts, signals, viewer, now, ordered, afterSale),
      facts,
      signals,
    };
  }

  /** The queues, counts included, as the viewer sees them, and the viewer's tasks due today. */
  async snapshot(ws: WorkspaceId, viewer: TodayViewer, now: Date): Promise<TodaySnapshot> {
    const endOfDay = endOfHcmDay(now);
    const taskScope = { userId: viewer.userId, viewAll: viewer.viewAll };
    const [read, taskCount, open] = await Promise.all([
      this.#queues(ws, viewer, now),
      this.crm.countOpenTasks(ws, { ...taskScope, dueBefore: endOfDay }),
      this.crm.listOpenTasks(ws, { ...taskScope, limit: TASKS_READ }),
    ]);
    const tasks = open
      .filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < endOfDay.getTime())
      .slice(0, TODAY_QUEUE_ITEMS_MAX);
    return { ...read, taskCount, tasks };
  }

  /**
   * How many items each queue holds (`GET /today/counts`: the sidebar badge; the morning
   * briefing). The queues only: no names, tasks list, usage or settings.
   */
  async counts(ws: WorkspaceId, viewer: TodayViewer, now: Date): Promise<TodayCounts> {
    const [{ queues }, tasks, approvals] = await Promise.all([
      this.#queues(ws, viewer, now),
      this.crm.countOpenTasks(ws, {
        userId: viewer.userId,
        viewAll: viewer.viewAll,
        dueBefore: endOfHcmDay(now),
      }),
      this.#approvals(ws, viewer, now, 0),
    ]);
    return {
      attention: queues.attention.length,
      unanswered: queues.unanswered.length,
      ready: queues.ready.length,
      price_silent: queues.price_silent.length,
      follow_up: queues.follow_up.length,
      approval: approvals.count,
      tasks,
    };
  }

  async today(ws: WorkspaceId, viewer: TodayViewer, now = new Date()): Promise<TodayResponse> {
    const [snap, usage, settings, approvals] = await Promise.all([
      this.snapshot(ws, viewer, now),
      this.usage.usage(ws, now),
      this.settings.get(ws),
      this.#approvals(ws, viewer, now, TODAY_QUEUE_ITEMS_MAX),
    ]);
    const shown = TODAY_CONVERSATION_QUEUES.map((key) => ({
      key,
      count: snap.queues[key].length,
      entries: snap.queues[key].slice(0, TODAY_QUEUE_ITEMS_MAX),
    }));
    const names = await this.#names(shown.flatMap((q) => q.entries.map((e) => e.facts.assigneeId)));
    return {
      queues: [
        ...shown.map(({ key, count, entries }) => ({
          key,
          count,
          items: entries.map((e) => toItem(e, names)),
        })),
        {
          key: 'approval' as const,
          count: approvals.count,
          items: approvals.items.slice(0, TODAY_QUEUE_ITEMS_MAX),
        },
        { key: 'tasks' as const, count: snap.taskCount, items: snap.tasks },
      ],
      usage: { used: usage.used, limit: usage.limit },
      mode: settings.mode,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Evaluates the viewer's conversations whose customer messages were not evaluated yet, the
   * ones on Today first (queue order), then those with an idle evaluation waiting; at most 20,
   * three at a time, until the day's evaluations run out or `budgetMs` has passed (no new
   * evaluation starts after it: `partial`, with how many are `remaining`). Then the fresh Today.
   */
  async refresh(
    ws: WorkspaceId,
    viewer: TodayViewer,
    now = new Date(),
    budgetMs = REFRESH_BUDGET_MS,
  ): Promise<RefreshTodayResponse> {
    const deadline = Date.now() + budgetMs;
    const snap = await this.snapshot(ws, viewer, now);
    const known = new Map(snap.facts.map((f) => [f.id, f]));
    const pending = (await this.store.pendingJobIds(ws, CANDIDATES_MAX)).filter(
      (id) => !known.has(id),
    );
    if (pending.length) {
      const more = await this.conversations.todayCandidates(ws, {
        ids: pending,
        awaitingBefore: EPOCH,
        followUpBefore: EPOCH,
        limit: CANDIDATES_MAX,
        visibleTo: viewer.viewAll ? undefined : viewer.userId,
        lastHumanFor: [],
      });
      await this.#loadSignals(
        ws,
        more.map((f) => f.id),
        snap.signals,
      );
      more
        .sort((a, b) => Date.parse(b.lastInboundAt ?? '') - Date.parse(a.lastInboundAt ?? ''))
        .forEach((f) => known.set(f.id, f));
    }
    const ordered = [
      ...TODAY_CONVERSATION_QUEUES.flatMap((key) => snap.queues[key].map((e) => e.facts)),
      ...known.values(),
    ];
    const picked: string[] = [];
    for (const f of ordered) {
      if (picked.length >= REFRESH_MAX) break;
      if (picked.includes(f.id) || f.status === 'spam' || !visibleTo(f, viewer)) continue;
      if (hasUnevaluated(f, snap.signals.get(f.id) ?? null)) picked.push(f.id);
    }

    let evaluated = 0;
    let capped = false;
    const usage = await this.usage.usage(ws, now);
    if (usage.limit !== null && usage.used >= usage.limit && picked.length) capped = true;
    const queue = capped ? [] : [...picked];
    const work = async () => {
      while (!capped && Date.now() < deadline) {
        const id = queue.shift();
        if (id === undefined) return;
        try {
          const r = await this.evaluator.evaluate(ws, id, 'refresh', now);
          if (r.status === 'ok') evaluated++;
          else if (r.status === 'capped') capped = true;
        } catch (e) {
          this.#log.warn(`refresh evaluation of ${id} failed (${errorClass(e)})`);
        }
      }
    };
    await Promise.all(Array.from({ length: REFRESH_PARALLEL }, work));
    const remaining = capped ? 0 : queue.length;
    return {
      ...(await this.today(ws, viewer, new Date())),
      evaluated,
      capped,
      partial: remaining > 0,
      remaining,
    };
  }

  /**
   * Hides the conversation from Today until a customer message newer than now arrives. NOT_FOUND
   * when it is not in this workspace or not the viewer's to see.
   */
  async dismiss(
    ws: WorkspaceId,
    viewer: TodayViewer,
    conversationId: string,
    now = new Date(),
  ): Promise<void> {
    const f = await this.#visible(ws, viewer, conversationId);
    await this.store.dismissSignal(ws, conversationId, f.contactId, now);
  }

  /** Undoes a dismiss ("Hoàn tác"): the conversation is back on Today. Same NOT_FOUND rule. */
  async undismiss(
    ws: WorkspaceId,
    viewer: TodayViewer,
    conversationId: string,
    now = new Date(),
  ): Promise<void> {
    await this.#visible(ws, viewer, conversationId);
    await this.store.undismissSignal(ws, conversationId, now);
  }

  async #visible(ws: WorkspaceId, viewer: TodayViewer, conversationId: string) {
    const [f] = await this.conversations.todayCandidates(ws, {
      ids: [conversationId],
      awaitingBefore: EPOCH,
      followUpBefore: EPOCH,
      limit: 1,
      lastHumanFor: [],
    });
    if (!f || f.id !== conversationId || !visibleTo(f, viewer)) {
      throw new SignalConversationNotFoundError(conversationId);
    }
    return f;
  }

  /**
   * Conversations whose signal says `ready` but that got an order or booking since it was judged
   * (spec §5: "Sắp chốt" ends there). A failed read leaves them listed.
   */
  async #ordered(
    ws: WorkspaceId,
    facts: readonly TodayFacts[],
    signals: ReadonlyMap<string, ConversationSignal>,
  ): Promise<Set<string>> {
    const ready = facts.filter((f) => signals.get(f.id)?.stage === 'ready').map((f) => f.id);
    const out = new Set<string>();
    if (!ready.length) return out;
    const read = (p: Promise<{ conversationId: string; at: Date }[]> | undefined) =>
      (p ?? Promise.resolve([])).catch((e: unknown) => {
        this.#log.warn(`orders of Today not read (${errorClass(e)})`);
        return [];
      });
    const times = (
      await Promise.all([
        read(this.commerce?.latestOrderTimes(ws, ready)),
        read(this.lodging?.latestBookingTimes(ws, ready)),
      ])
    ).flat();
    for (const t of times) {
      const s = signals.get(t.conversationId);
      if (s && orderedSinceSignal(s, t.at)) out.add(t.conversationId);
    }
    return out;
  }

  async #loadSignals(
    ws: WorkspaceId,
    ids: readonly string[],
    into: Map<string, ConversationSignal>,
  ): Promise<void> {
    const missing = ids.filter((id) => !into.has(id));
    for (let i = 0; i < missing.length; i += SIGNAL_CHUNK) {
      for (const s of await this.store.signalsFor(ws, missing.slice(i, i + SIGNAL_CHUNK))) {
        into.set(s.conversationId, s);
      }
    }
  }

  /** Display names of the assignees (a removed member or an unknown id has none). */
  async #names(ids: readonly (string | null)[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    const names = await Promise.all(
      unique.map((id) => this.identity.displayName(userId(id)).catch(() => null)),
    );
    return new Map(unique.map((id, i) => [id, names[i] ?? null]));
  }
}

/** A customer message arrived after the messages the last evaluation covered (`newAfter`). */
function hasUnevaluated(f: TodayFacts, s: ConversationSignal | null): boolean {
  if (!f.lastInboundAt) return false;
  return Date.parse(f.lastInboundAt) > newAfter(s);
}

function toItem(e: TodayEntry, names: ReadonlyMap<string, string | null>): TodayItem {
  const f = e.facts;
  return {
    conversationId: f.id,
    contactId: f.contactId,
    customerName: f.customerName,
    avatarUrl: f.customerAvatarUrl,
    channel: f.provider,
    reason: e.reason.slice(0, 200),
    stage: e.signal?.stage ?? 'new',
    mood: e.signal?.mood ?? 'neutral',
    at: e.at.toISOString(),
    assigneeId: f.assigneeId,
    assigneeName: f.assigneeId ? (names.get(f.assigneeId) ?? null) : null,
    stageLocked: e.signal?.stageLocked ?? false,
    ...(e.careTemplate ? { careTemplate: e.careTemplate } : {}),
  };
}
