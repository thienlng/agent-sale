import { PRUNED_TOOL_TEXT } from '@agent-sales/ai-core';

import {
  type AssistantRepository,
  type CompactionInput,
  MEMORY_STORE_PATTERN,
  type MemoryEntry,
  type MemoryStoreRecord,
  type MessageRecord,
  type NewMessage,
  type NewProposal,
  type ProposalPatch,
  type ProposalRecord,
  type ProposalStatus,
  type RunRecord,
  RUN_BUSY_WINDOW_MS,
  type SearchHit,
  type StepRecord,
  THREAD_LIST_LIMIT,
  type ThreadRecord,
} from '../../domain/ports/assistant.repository.js';
import { AssistantNotFoundError, AssistantRunIdTakenError } from '../../domain/assistant.errors.js';
import type { OwnerScope } from '../../domain/owner-scope.js';
import { foldText, snippetAround } from '../../domain/search-text.js';

interface Owned {
  accountId: string;
  ownerUserId: string;
}
type StoredThread = ThreadRecord & Owned & { origin: 'chat' | 'schedule' | 'review' };
type StoredMessage = MessageRecord &
  Owned & { active: boolean; compacted: boolean; sortSeq: number };
type StoredRun = RunRecord & Owned;
type StoredMemory = MemoryStoreRecord & Owned;
type StoredProposal = ProposalRecord & Owned;

const mine = (s: OwnerScope, row: Owned) =>
  row.accountId === s.accountId && row.ownerUserId === s.ownerUserId;

/** Process-local twin of the Drizzle repository (tests, and the API without a database). */
export class InMemoryAssistantRepository implements AssistantRepository {
  readonly threads = new Map<string, StoredThread>();
  readonly messages: StoredMessage[] = [];
  readonly runs = new Map<string, StoredRun>();
  readonly steps: (StepRecord & { accountId: string })[] = [];
  readonly memory: StoredMemory[] = [];
  readonly proposals = new Map<string, StoredProposal>();
  #clock = 0;

  /** Strictly increasing timestamps so ordering is deterministic in tests. */
  #now(): Date {
    this.#clock = Math.max(this.#clock + 1, Date.now());
    return new Date(this.#clock);
  }

  #thread(s: OwnerScope, threadId: string): StoredThread {
    const t = this.threads.get(threadId);
    if (!t || !mine(s, t)) throw new AssistantNotFoundError('thread', threadId);
    return t;
  }

  #run(s: OwnerScope, runId: string): StoredRun {
    const r = this.runs.get(runId);
    if (!r || !mine(s, r)) throw new AssistantNotFoundError('run', runId);
    return r;
  }

  #publicThread(t: StoredThread): ThreadRecord {
    const { accountId: _a, ownerUserId: _o, origin: _g, ...rest } = t;
    return structuredClone(rest);
  }

  #publicMessage(m: StoredMessage): MessageRecord {
    const { accountId: _a, ownerUserId: _o, active: _v, compacted: _c, sortSeq: _s, ...rest } = m;
    return structuredClone(rest);
  }

  async listThreads(
    s: OwnerScope,
    q: { archived: boolean; text?: string },
  ): Promise<ThreadRecord[]> {
    const text = foldText(q.text?.trim() ?? '');
    const matchingThreads = new Set(
      text
        ? this.messages
            .filter(
              (m) =>
                mine(s, m) &&
                (m.role === 'user' || m.role === 'assistant') &&
                foldText(m.content).includes(text),
            )
            .map((m) => m.threadId)
        : [],
    );
    const rows = [...this.threads.values()]
      .filter((t) => mine(s, t) && t.archived === q.archived)
      .filter((t) => !text || foldText(t.title).includes(text) || matchingThreads.has(t.id))
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
      )
      .slice(0, THREAD_LIST_LIMIT);
    return rows.map((t) => this.#publicThread(t));
  }

  async getThread(s: OwnerScope, threadId: string): Promise<ThreadRecord | null> {
    const t = this.threads.get(threadId);
    return t && mine(s, t) ? this.#publicThread(t) : null;
  }

  async createThread(
    s: OwnerScope,
    t: { id: string; title: string; systemPrompt: string; promptVersion: string },
  ): Promise<ThreadRecord> {
    const now = this.#now();
    const row: StoredThread = {
      ...t,
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      origin: 'chat',
      pinned: false,
      archived: false,
      businessId: s.businessId,
      createdAt: now,
      lastMessageAt: now,
      cacheRootId: null,
      compactedAt: null,
      compactionFailedAt: null,
      compactionSavedPcts: [],
    };
    this.threads.set(t.id, row);
    return this.#publicThread(row);
  }

  async updateThread(
    s: OwnerScope,
    threadId: string,
    patch: Partial<Pick<ThreadRecord, 'title' | 'pinned' | 'archived'>>,
  ): Promise<ThreadRecord | null> {
    const t = this.threads.get(threadId);
    if (!t || !mine(s, t)) return null;
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.pinned !== undefined) t.pinned = patch.pinned;
    if (patch.archived !== undefined) t.archived = patch.archived;
    return this.#publicThread(t);
  }

  async listMessages(
    s: OwnerScope,
    threadId: string,
    opts?: { activeOnly?: boolean },
  ): Promise<MessageRecord[]> {
    this.#thread(s, threadId);
    const rows = this.messages
      .filter((m) => m.threadId === threadId && mine(s, m) && (!opts?.activeOnly || m.active))
      .sort((a, b) => (opts?.activeOnly ? a.sortSeq - b.sortSeq : 0) || a.seq - b.seq);
    return rows.map((m) => this.#publicMessage(m));
  }

  async appendMessages(
    s: OwnerScope,
    threadId: string,
    msgs: NewMessage[],
  ): Promise<MessageRecord[]> {
    const thread = this.#thread(s, threadId);
    let seq = Math.max(
      0,
      ...this.messages.filter((m) => m.threadId === threadId).map((m) => m.seq),
    );
    const added = msgs.map((m) => {
      const row: StoredMessage = {
        ...structuredClone(m),
        threadId,
        seq: ++seq,
        sortSeq: seq,
        isSummary: false,
        createdAt: this.#now(),
        accountId: s.accountId,
        ownerUserId: s.ownerUserId,
        active: true,
        compacted: false,
      };
      this.messages.push(row);
      return row;
    });
    if (added.length) thread.lastMessageAt = this.#now();
    return added.map((m) => this.#publicMessage(m));
  }

  async searchMessages(s: OwnerScope, query: string, limit: number): Promise<SearchHit[]> {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const late = (m: StoredMessage) => {
      const origin = this.threads.get(m.threadId)?.origin;
      return origin === 'schedule' || origin === 'review' ? 1 : 0;
    };
    const hits = this.messages
      .filter((m) => mine(s, m) && (m.role === 'user' || m.role === 'assistant'))
      .filter((m) => {
        const text = foldText(m.content);
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => late(a) - late(b) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({
        threadId: m.threadId,
        threadTitle: this.threads.get(m.threadId)?.title ?? '',
        messageId: m.id,
        seq: m.seq,
        role: m.role,
        snippet: snippetAround(m.content, query),
        createdAt: new Date(m.createdAt),
      }));
    return hits;
  }

  async startRun(
    s: OwnerScope,
    r: { id: string; threadId: string; tier: string; promptVersion: string },
  ): Promise<'started' | 'busy' | 'duplicate'> {
    this.#thread(s, r.threadId);
    const existing = this.runs.get(r.id);
    if (existing) {
      if (mine(s, existing)) return 'duplicate';
      throw new AssistantRunIdTakenError();
    }
    const now = this.#now();
    const busy = [...this.runs.values()].some(
      (x) =>
        mine(s, x) &&
        x.status === 'running' &&
        now.getTime() - x.createdAt.getTime() < RUN_BUSY_WINDOW_MS,
    );
    if (busy) return 'busy';
    this.runs.set(r.id, {
      ...r,
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      kind: 'chat',
      status: 'running',
      provider: null,
      model: null,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      rounds: 0,
      outcome: null,
      guardrail: null,
      createdAt: now,
      finishedAt: null,
    });
    return 'started';
  }

  async addStep(s: OwnerScope, step: StepRecord): Promise<void> {
    this.#run(s, step.runId);
    this.steps.push({ ...step, accountId: s.accountId });
  }

  async finishRun(s: OwnerScope, runId: string, patch: Partial<RunRecord>): Promise<void> {
    const run = this.#run(s, runId);
    const { id: _i, threadId: _t, kind: _k, createdAt: _c, ...allowed } = patch;
    Object.assign(run, allowed);
  }

  async getRun(
    s: OwnerScope,
    runId: string,
  ): Promise<(RunRecord & { steps: StepRecord[] }) | null> {
    const run = this.runs.get(runId);
    if (!run || !mine(s, run)) return null;
    const { accountId: _a, ownerUserId: _o, ...rest } = run;
    const steps = this.steps
      .filter((x) => x.runId === runId)
      .sort((a, b) => a.idx - b.idx)
      .map(({ accountId: _x, ...step }) => step);
    return { ...structuredClone(rest), steps };
  }

  // ─── Memory ───

  async getMemory(s: OwnerScope): Promise<MemoryStoreRecord[]> {
    return this.memory
      .filter((x) => mine(s, x))
      .sort((a, b) => (a.store < b.store ? -1 : a.store > b.store ? 1 : 0))
      .map(({ accountId: _a, ownerUserId: _o, ...rest }) => structuredClone(rest));
  }

  async saveMemoryStore(
    s: OwnerScope,
    store: string,
    entries: MemoryEntry[],
  ): Promise<MemoryStoreRecord> {
    // Mirrors the table's CHECK constraint.
    if (!MEMORY_STORE_PATTERN.test(store)) throw new Error(`invalid assistant memory store`);
    let row = this.memory.find((x) => mine(s, x) && x.store === store);
    if (!row) {
      row = {
        accountId: s.accountId,
        ownerUserId: s.ownerUserId,
        store,
        entries: [],
        updatedAt: this.#now(),
      };
      this.memory.push(row);
    }
    row.entries = structuredClone(entries);
    row.updatedAt = this.#now();
    const { accountId: _a, ownerUserId: _o, ...rest } = row;
    return structuredClone(rest);
  }

  // ─── Proposals ───

  #publicProposal(p: StoredProposal): ProposalRecord {
    const { accountId: _a, ownerUserId: _o, ...rest } = p;
    return structuredClone(rest);
  }

  async createProposal(s: OwnerScope, p: NewProposal): Promise<ProposalRecord> {
    this.#thread(s, p.threadId);
    if (this.proposals.has(p.id)) throw new Error('assistant proposal id already used');
    if (p.summary.length > 300) throw new Error('assistant proposal summary too long');
    const row: StoredProposal = {
      ...structuredClone(p),
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      status: 'pending',
      errorCode: null,
      resultPreview: null,
      decidedAt: null,
      createdAt: this.#now(),
    };
    this.proposals.set(p.id, row);
    return this.#publicProposal(row);
  }

  async listProposals(s: OwnerScope, threadId: string): Promise<ProposalRecord[]> {
    this.#thread(s, threadId);
    return [...this.proposals.values()]
      .filter((p) => p.threadId === threadId && mine(s, p))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => this.#publicProposal(p));
  }

  async getProposal(s: OwnerScope, id: string): Promise<ProposalRecord | null> {
    const p = this.proposals.get(id);
    return p && mine(s, p) ? this.#publicProposal(p) : null;
  }

  async transitionProposal(
    s: OwnerScope,
    id: string,
    from: ProposalStatus[],
    to: ProposalStatus,
    patch: ProposalPatch = {},
  ): Promise<ProposalRecord | null> {
    // No await between the check and the write: atomic within this process.
    const p = this.proposals.get(id);
    if (!p || !mine(s, p) || !from.includes(p.status)) return null;
    p.status = to;
    if (patch.errorCode !== undefined) p.errorCode = patch.errorCode;
    if (patch.resultPreview !== undefined) p.resultPreview = patch.resultPreview;
    if (patch.decidedAt !== undefined) p.decidedAt = patch.decidedAt;
    return this.#publicProposal(p);
  }

  async expireProposals(s: OwnerScope, now: Date): Promise<number> {
    let n = 0;
    for (const p of this.proposals.values()) {
      if (mine(s, p) && p.status === 'pending' && p.expiresAt.getTime() < now.getTime()) {
        p.status = 'expired';
        n++;
      }
    }
    return n;
  }

  // ─── Compaction ───

  async applyCompaction(
    s: OwnerScope,
    threadId: string,
    c: CompactionInput,
  ): Promise<MessageRecord> {
    const thread = this.#thread(s, threadId);
    if (c.deactivateIds.length === 0) {
      throw new Error('assistant compaction needs a middle to summarise');
    }
    const ids = new Set(c.deactivateIds);
    const middle = this.messages.filter(
      (m) => m.threadId === threadId && mine(s, m) && m.active && ids.has(m.id),
    );
    if (middle.length !== ids.size) throw new Error('assistant compaction plan is stale');
    for (const m of middle) {
      m.active = false;
      m.compacted = true;
    }
    const pruned = new Set(c.prunedToolIds);
    for (const m of this.messages) {
      if (
        m.threadId === threadId &&
        mine(s, m) &&
        m.active &&
        m.role === 'tool' &&
        pruned.has(m.id)
      ) {
        m.content = PRUNED_TOOL_TEXT;
      }
    }
    const last = Math.max(
      0,
      ...this.messages.filter((m) => m.threadId === threadId).map((m) => m.seq),
    );
    const row: StoredMessage = {
      ...structuredClone(c.summary),
      threadId,
      seq: last + 1,
      sortSeq: Math.min(...middle.map((m) => m.seq)) - 0.5,
      isSummary: true,
      createdAt: this.#now(),
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      active: true,
      compacted: false,
    };
    this.messages.push(row);
    thread.systemPrompt = c.systemPrompt;
    thread.compactedAt = this.#now();
    thread.compactionSavedPcts = [...thread.compactionSavedPcts, c.savedPct].slice(-2);
    thread.cacheRootId ??= thread.id;
    return this.#publicMessage(row);
  }

  async markCompactionFailed(s: OwnerScope, threadId: string, at: Date): Promise<void> {
    this.#thread(s, threadId).compactionFailedAt = at;
  }
}
