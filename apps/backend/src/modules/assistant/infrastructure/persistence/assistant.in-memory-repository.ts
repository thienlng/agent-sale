import { PRUNED_TOOL_TEXT } from '@agent-sales/ai-core';

import {
  type AssistantRepository,
  type AssistantSettingsRecord,
  type CompactionInput,
  DEFAULT_ASSISTANT_SETTINGS,
  JOB_MAX_ATTEMPTS,
  type JobKind,
  type JobRecord,
  type ReviewScope,
  type MessageFeedback,
  type NewJob,
  type NewSkill,
  type NewSkillEvent,
  type NewSuggestion,
  type OwnerKey,
  type ReviewCounters,
  type SettingsPatch,
  SKILL_EVENT_LIST_LIMIT,
  type SkillEventInput,
  type SkillEventQuery,
  type SkillEventRecord,
  type SkillPatch,
  type SkillProvenance,
  type SkillRecord,
  type SkillState,
  skillSnapshot,
  type SuggestionRecord,
  type SuggestionStatus,
  MEMORY_STORE_PATTERN,
  type MemoryEntry,
  type MemoryStoreRecord,
  type MessageRecord,
  type NewMessage,
  type NewProposal,
  type ProposalPatch,
  type ProposalRecord,
  type ProposalStatus,
  type RecordedRun,
  type RunRecord,
  RUN_BUSY_WINDOW_MS,
  type SearchHit,
  type StepRecord,
  summarySortSeq,
  THREAD_LIST_LIMIT,
  type ThreadRecord,
} from '../../domain/ports/assistant.repository.js';
import {
  AssistantNotFoundError,
  AssistantRunIdTakenError,
  AssistantSkillNameTakenError,
} from '../../domain/assistant.errors.js';
import type { OwnerScope } from '../../domain/owner-scope.js';
import { foldText, snippetAround } from '../../domain/search-text.js';

interface Owned {
  accountId: string;
  ownerUserId: string;
}
type StoredThread = ThreadRecord & Owned;
type StoredMessage = MessageRecord &
  Owned & { active: boolean; compacted: boolean; sortSeq: number };
type StoredRun = RunRecord & Owned;
type StoredMemory = MemoryStoreRecord & Owned;
type StoredProposal = ProposalRecord & Owned;
type StoredSkill = SkillRecord & Owned;
type StoredSkillEvent = SkillEventRecord & Owned;
type StoredSuggestion = SuggestionRecord & Owned;
type StoredSettings = AssistantSettingsRecord & Owned;

/** Mirrors the table's CHECK constraints on a skill row. */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
function checkSkill(x: Pick<SkillRecord, 'name' | 'description' | 'body'>): void {
  if (!SKILL_NAME_PATTERN.test(x.name) || x.name.length > 64) {
    throw new Error('invalid assistant skill name');
  }
  if (x.description.length > 120) throw new Error('assistant skill description too long');
  if (x.body.length > 8000) throw new Error('assistant skill body too long');
}

const strip = <T extends Owned>(row: T): Omit<T, keyof Owned> => {
  const { accountId: _a, ownerUserId: _o, ...rest } = row;
  return structuredClone(rest);
};

const mine = (s: Owned, row: Owned) =>
  row.accountId === s.accountId && row.ownerUserId === s.ownerUserId;

/** Two review scopes on one queued job: different scopes become `combined`. */
const mergeScope = (a: ReviewScope | null, b: ReviewScope | null): ReviewScope | null =>
  a && b && a !== b ? 'combined' : (a ?? b);

/** Process-local twin of the Drizzle repository (tests, and the API without a database). */
export class InMemoryAssistantRepository implements AssistantRepository {
  readonly threads = new Map<string, StoredThread>();
  readonly messages: StoredMessage[] = [];
  readonly runs = new Map<string, StoredRun>();
  readonly steps: (StepRecord & { accountId: string })[] = [];
  readonly memory: StoredMemory[] = [];
  readonly proposals = new Map<string, StoredProposal>();
  readonly skills = new Map<string, StoredSkill>();
  readonly skillEvents: StoredSkillEvent[] = [];
  readonly suggestions: StoredSuggestion[] = [];
  readonly settings: StoredSettings[] = [];
  readonly jobs = new Map<string, JobRecord>();
  #clock = 0;

  /** Strictly increasing timestamps so ordering is deterministic in tests. */
  #now(): Date {
    this.#clock = Math.max(this.#clock + 1, Date.now());
    return new Date(this.#clock);
  }

  #thread(s: OwnerKey, threadId: string): StoredThread {
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
    const { accountId: _a, ownerUserId: _o, ...rest } = t;
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
                !m.isSummary &&
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

  async getThread(s: OwnerKey, threadId: string): Promise<ThreadRecord | null> {
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
      reviewOwnerTurns: 0,
      reviewToolRounds: 0,
      lastReviewAt: null,
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
        feedback: null,
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
      .filter((m) => mine(s, m) && !m.isSummary && (m.role === 'user' || m.role === 'assistant'))
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

  async getLastChatRun(s: OwnerScope, threadId: string): Promise<RunRecord | null> {
    this.#thread(s, threadId);
    const last = [...this.runs.values()]
      .filter((x) => mine(s, x) && x.threadId === threadId && x.kind === 'chat')
      .filter((x) => x.status === 'done')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!last) return null;
    const { accountId: _a, ownerUserId: _o, ...rest } = last;
    return structuredClone(rest);
  }

  async recordRun(s: OwnerScope, r: RecordedRun): Promise<void> {
    if (r.threadId) this.#thread(s, r.threadId);
    if (this.runs.has(r.id)) throw new AssistantRunIdTakenError();
    const now = this.#now();
    this.runs.set(r.id, {
      ...r,
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      createdAt: now,
      finishedAt: now,
    });
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
      sortSeq: summarySortSeq(middle),
      isSummary: true,
      feedback: null,
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
  // ─── Skills ───

  #skill(s: OwnerKey, id: string): StoredSkill | null {
    const x = this.skills.get(id);
    return x && mine(s, x) ? x : null;
  }

  #nameTaken(s: OwnerKey, name: string, exceptId: string): boolean {
    return [...this.skills.values()].some(
      (x) => mine(s, x) && x.id !== exceptId && x.name === name && x.state !== 'archived',
    );
  }

  /** Strictly greater than `prev` and millisecond-precise, like the SQL `updated_at`. */
  #nextVersion(prev?: Date): Date {
    const now = this.#now();
    return prev && now.getTime() <= prev.getTime() ? new Date(prev.getTime() + 1) : now;
  }

  async listSkills(
    s: OwnerKey,
    q: { states?: SkillState[]; provenance?: SkillProvenance[] } = {},
  ): Promise<SkillRecord[]> {
    return [...this.skills.values()]
      .filter((x) => mine(s, x))
      .filter((x) => !q.states || q.states.includes(x.state))
      .filter((x) => !q.provenance || q.provenance.includes(x.provenance))
      .sort(
        (a, b) =>
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .map(strip);
  }

  async getSkill(s: OwnerKey, id: string): Promise<SkillRecord | null> {
    const x = this.#skill(s, id);
    return x ? strip(x) : null;
  }

  async getSkillByName(s: OwnerKey, name: string): Promise<SkillRecord | null> {
    const x = [...this.skills.values()].find(
      (k) => mine(s, k) && k.name === name && k.state !== 'archived',
    );
    return x ? strip(x) : null;
  }

  async createSkill(s: OwnerKey, skill: NewSkill, event?: SkillEventInput): Promise<SkillRecord> {
    checkSkill(skill);
    if ((skill.provenance === 'shadow') !== (skill.shadowOf !== null)) {
      throw new Error('assistant skill shadow_of must be set for shadows only');
    }
    if (this.skills.has(skill.id)) throw new Error('assistant skill id already used');
    if (skill.state !== 'archived' && this.#nameTaken(s, skill.name, skill.id)) {
      throw new AssistantSkillNameTakenError();
    }
    const now = this.#now();
    const row: StoredSkill = {
      ...structuredClone(skill),
      pinned: skill.pinned ?? false,
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      useCount: 0,
      viewCount: 0,
      patchCount: 0,
      lastUsedAt: null,
      lastPatchedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.skills.set(skill.id, row);
    if (event) {
      this.#pushEvent(s, { ...event, skillId: row.id, before: null, after: skillSnapshot(row) });
    }
    return strip(row);
  }

  async updateSkill(
    s: OwnerKey,
    id: string,
    patch: SkillPatch,
    opts: { expectedUpdatedAt?: Date; event?: SkillEventInput } = {},
  ): Promise<SkillRecord | null> {
    const x = this.#skill(s, id);
    if (!x) return null;
    if (opts.expectedUpdatedAt && x.updatedAt.getTime() !== opts.expectedUpdatedAt.getTime()) {
      return null;
    }
    const before = skillSnapshot(x);
    const next = {
      name: patch.name ?? x.name,
      description: patch.description ?? x.description,
      body: patch.body ?? x.body,
      state: patch.state ?? x.state,
    };
    checkSkill(next);
    if (next.state !== 'archived' && this.#nameTaken(s, next.name, id)) {
      throw new AssistantSkillNameTakenError();
    }
    Object.assign(x, next);
    if (patch.toolsets !== undefined) x.toolsets = [...patch.toolsets];
    if (patch.pinned !== undefined) x.pinned = patch.pinned;
    if (patch.countPatch) {
      x.patchCount += 1;
      x.lastPatchedAt = this.#now();
    }
    x.updatedAt = this.#nextVersion(x.updatedAt);
    if (opts.event) {
      this.#pushEvent(s, { ...opts.event, skillId: id, before, after: skillSnapshot(x) });
    }
    return strip(x);
  }

  async bumpSkillCounter(s: OwnerKey, id: string, counter: 'use' | 'view'): Promise<void> {
    const x = this.#skill(s, id);
    if (!x) throw new AssistantNotFoundError('skill', id);
    if (counter === 'use') {
      x.useCount += 1;
      x.lastUsedAt = this.#now();
    } else {
      x.viewCount += 1;
    }
  }

  #pushEvent(s: OwnerKey, e: NewSkillEvent): StoredSkillEvent {
    if (this.skillEvents.some((x) => x.id === e.id)) {
      throw new Error('assistant skill event id already used');
    }
    const row: StoredSkillEvent = {
      ...structuredClone(e),
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      undoneAt: null,
      createdAt: this.#now(),
    };
    this.skillEvents.push(row);
    return row;
  }

  async appendSkillEvent(s: OwnerKey, e: NewSkillEvent): Promise<SkillEventRecord> {
    if (!this.#skill(s, e.skillId)) throw new AssistantNotFoundError('skill', e.skillId);
    return strip(this.#pushEvent(s, e));
  }

  async listSkillEvents(s: OwnerKey, q: SkillEventQuery): Promise<SkillEventRecord[]> {
    const limit = Math.min(q.limit ?? SKILL_EVENT_LIST_LIMIT, SKILL_EVENT_LIST_LIMIT);
    return this.skillEvents
      .filter((x) => mine(s, x))
      .filter((x) => !q.skillId || x.skillId === q.skillId)
      .filter((x) => !q.since || x.createdAt.getTime() >= q.since.getTime())
      .filter((x) => !q.actor || x.actor === q.actor)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(strip);
  }

  async getSkillEvent(s: OwnerKey, id: string): Promise<SkillEventRecord | null> {
    const x = this.skillEvents.find((e) => e.id === id && mine(s, e));
    return x ? strip(x) : null;
  }

  async markSkillEventUndone(s: OwnerKey, id: string, at: Date): Promise<SkillEventRecord | null> {
    const x = this.skillEvents.find((e) => e.id === id && mine(s, e));
    if (!x || x.undoneAt) return null;
    x.undoneAt = at;
    return strip(x);
  }

  // ─── Suggestions ───

  async listSuggestions(
    s: OwnerKey,
    q: { status?: SuggestionStatus } = {},
  ): Promise<SuggestionRecord[]> {
    return this.suggestions
      .filter((x) => mine(s, x) && (!q.status || x.status === q.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(strip);
  }

  async upsertSuggestion(s: OwnerKey, x: NewSuggestion): Promise<SuggestionRecord | null> {
    if (x.dedupKey.length > 120) throw new Error('assistant suggestion dedup key too long');
    if (x.title.length > 200) throw new Error('assistant suggestion title too long');
    if (this.suggestions.some((g) => mine(s, g) && g.dedupKey === x.dedupKey)) return null;
    const row: StoredSuggestion = {
      ...structuredClone(x),
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      status: 'pending',
      createdAt: this.#now(),
      decidedAt: null,
    };
    this.suggestions.push(row);
    return strip(row);
  }

  async decideSuggestion(
    s: OwnerKey,
    id: string,
    status: 'accepted' | 'dismissed',
    at: Date,
  ): Promise<SuggestionRecord | null> {
    const x = this.suggestions.find((g) => g.id === id && mine(s, g));
    if (!x || x.status !== 'pending') return null;
    x.status = status;
    x.decidedAt = at;
    return strip(x);
  }

  // ─── Settings ───

  async countToolUses(s: OwnerKey, since: Date): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const step of this.steps) {
      const run = this.runs.get(step.runId);
      if (!run || !mine(s, run) || run.kind !== 'chat') continue;
      if (run.createdAt.getTime() < since.getTime()) continue;
      if (step.kind !== 'tool' || !step.toolName) continue;
      counts[step.toolName] = (counts[step.toolName] ?? 0) + 1;
    }
    return counts;
  }

  async getSettings(s: OwnerKey): Promise<AssistantSettingsRecord> {
    const x = this.settings.find((r) => mine(s, r));
    return x ? strip(x) : { ...DEFAULT_ASSISTANT_SETTINGS, disabledToolsets: [] };
  }

  async saveSettings(s: OwnerKey, patch: SettingsPatch): Promise<AssistantSettingsRecord> {
    let x = this.settings.find((r) => mine(s, r));
    if (!x) {
      x = {
        ...DEFAULT_ASSISTANT_SETTINGS,
        disabledToolsets: [],
        accountId: s.accountId,
        ownerUserId: s.ownerUserId,
      };
      this.settings.push(x);
    }
    if (patch.reviewEnabled !== undefined) x.reviewEnabled = patch.reviewEnabled;
    if (patch.disabledToolsets !== undefined) x.disabledToolsets = [...patch.disabledToolsets];
    if (patch.curatorRanAt !== undefined) x.curatorRanAt = patch.curatorRanAt;
    x.updatedAt = this.#now();
    return strip(x);
  }

  // ─── Feedback ───

  async setFeedback(s: OwnerKey, messageId: string, value: MessageFeedback | null): Promise<void> {
    const msg = this.messages.find((x) => x.id === messageId);
    const thread = msg ? this.threads.get(msg.threadId) : undefined;
    if (
      !msg ||
      !thread ||
      !mine(s, msg) ||
      !mine(s, thread) ||
      msg.role !== 'assistant' ||
      msg.isSummary
    ) {
      throw new AssistantNotFoundError('message', messageId);
    }
    msg.feedback = value;
  }

  // ─── Review counters ───

  #counters(t: StoredThread): ReviewCounters {
    return {
      ownerTurns: t.reviewOwnerTurns,
      toolRounds: t.reviewToolRounds,
      lastReviewAt: t.lastReviewAt ? new Date(t.lastReviewAt) : null,
    };
  }

  async bumpReviewCounters(
    s: OwnerKey,
    threadId: string,
    by: { ownerTurns: number; toolRounds: number },
  ): Promise<ReviewCounters> {
    const t = this.#thread(s, threadId);
    t.reviewOwnerTurns += by.ownerTurns;
    t.reviewToolRounds += by.toolRounds;
    return this.#counters(t);
  }

  async resetReviewCounters(
    s: OwnerKey,
    threadId: string,
    opts: { only?: 'ownerTurns' | 'toolRounds'; reviewedAt?: Date } = {},
  ): Promise<ReviewCounters> {
    const t = this.#thread(s, threadId);
    if (opts.only !== 'toolRounds') t.reviewOwnerTurns = 0;
    if (opts.only !== 'ownerTurns') t.reviewToolRounds = 0;
    if (opts.reviewedAt) t.lastReviewAt = opts.reviewedAt;
    return this.#counters(t);
  }

  // ─── Jobs ───

  async enqueueJob(s: OwnerKey, j: NewJob): Promise<JobRecord> {
    if (j.threadId) this.#thread(s, j.threadId);
    if ((j.kind === 'review') !== (j.reviewScope !== null)) {
      throw new Error('assistant job review_scope must be set for review jobs only');
    }
    const queued = [...this.jobs.values()].find(
      (x) => mine(s, x) && x.status === 'queued' && x.kind === j.kind && x.threadId === j.threadId,
    );
    if (queued) {
      const now = this.#now();
      if (queued.runAfter.getTime() > now.getTime()) queued.runAfter = j.runAfter;
      queued.reviewScope =
        queued.reviewScope && j.reviewScope && queued.reviewScope !== j.reviewScope
          ? 'combined'
          : j.reviewScope;
      queued.createdAt = now;
      return structuredClone(queued);
    }
    if (this.jobs.has(j.id)) throw new Error('assistant job id already used');
    const row: JobRecord = {
      ...structuredClone(j),
      accountId: s.accountId,
      ownerUserId: s.ownerUserId,
      status: 'queued',
      leaseUntil: null,
      attempts: 0,
      errorCode: null,
      createdAt: this.#now(),
      finishedAt: null,
    };
    this.jobs.set(j.id, row);
    return structuredClone(row);
  }

  async getJob(s: OwnerKey, id: string): Promise<JobRecord | null> {
    const x = this.jobs.get(id);
    return x && mine(s, x) ? structuredClone(x) : null;
  }

  async claimJobs(now: Date, limit: number, leaseMs: number): Promise<JobRecord[]> {
    const at = now.getTime();
    const lapsed = (x: JobRecord) =>
      x.status === 'running' && x.leaseUntil !== null && x.leaseUntil.getTime() < at;
    for (const x of this.jobs.values()) {
      if (lapsed(x) && x.attempts >= JOB_MAX_ATTEMPTS) {
        Object.assign(x, {
          status: 'failed',
          errorCode: 'lease_expired',
          finishedAt: now,
          leaseUntil: null,
        });
      }
    }
    const due = [...this.jobs.values()]
      .filter((x) => (x.status === 'queued' && x.runAfter.getTime() <= at) || lapsed(x))
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit);
    for (const x of due) {
      x.status = 'running';
      x.leaseUntil = new Date(at + leaseMs);
      x.attempts += 1;
    }
    return due.map((x) => structuredClone(x));
  }

  async finishJob(
    s: OwnerKey,
    job: { id: string; attempts: number },
    outcome: { status: 'done' | 'failed'; errorCode?: string | null },
  ): Promise<boolean> {
    const x = this.jobs.get(job.id);
    if (!x || !mine(s, x) || x.status !== 'running' || x.attempts !== job.attempts) return false;
    x.status = outcome.status;
    x.errorCode = outcome.errorCode ?? null;
    x.finishedAt = this.#now();
    x.leaseUntil = null;
    return true;
  }

  async retryJob(
    s: OwnerKey,
    job: { id: string; attempts: number },
    retry: { runAfter: Date; errorCode: string },
  ): Promise<boolean> {
    const x = this.jobs.get(job.id);
    if (!x || !mine(s, x) || x.status !== 'running' || x.attempts !== job.attempts) return false;
    const sibling = [...this.jobs.values()].find(
      (y) =>
        y !== x &&
        mine(s, y) &&
        y.status === 'queued' &&
        y.kind === x.kind &&
        y.threadId === x.threadId,
    );
    x.errorCode = retry.errorCode;
    x.leaseUntil = null;
    if (sibling) {
      // Merged into the queued job: it runs no later than the retry, with both scopes, and is
      // re-stamped so it no longer reads as an idle review that later messages push back.
      const now = this.#now();
      if (sibling.runAfter.getTime() > retry.runAfter.getTime()) sibling.runAfter = retry.runAfter;
      sibling.reviewScope = mergeScope(sibling.reviewScope, x.reviewScope);
      sibling.createdAt = now;
      x.status = 'failed';
      x.finishedAt = now;
    } else {
      x.status = 'queued';
      x.runAfter = retry.runAfter;
    }
    return true;
  }

  async cancelJob(
    s: OwnerKey,
    target: { id: string; attempts?: number } | { threadId: string; kind: JobKind },
  ): Promise<number> {
    let n = 0;
    for (const x of this.jobs.values()) {
      const hit =
        'id' in target
          ? x.id === target.id && (target.attempts === undefined || x.attempts === target.attempts)
          : x.threadId === target.threadId && x.kind === target.kind;
      if (hit && mine(s, x) && (x.status === 'queued' || x.status === 'running')) {
        x.status = 'cancelled';
        x.finishedAt = this.#now();
        x.leaseUntil = null;
        n++;
      }
    }
    return n;
  }

  // ─── Curator ───

  async listLearnedSkillsForCurator(s: OwnerKey): Promise<SkillRecord[]> {
    return this.listSkills(s, { provenance: ['learned'], states: ['active', 'stale'] });
  }

  async ownersWithLearnedSkills(opts: { ranBefore?: Date } = {}): Promise<OwnerKey[]> {
    const owners = new Map<string, OwnerKey>();
    for (const x of this.skills.values()) {
      if (x.provenance !== 'learned' || (x.state !== 'active' && x.state !== 'stale')) continue;
      if (opts.ranBefore) {
        const ran = this.settings.find((r) => mine(x, r))?.curatorRanAt;
        if (ran && ran.getTime() >= opts.ranBefore.getTime()) continue;
      }
      owners.set(`${x.accountId}:${x.ownerUserId}`, {
        accountId: x.accountId,
        ownerUserId: x.ownerUserId as OwnerKey['ownerUserId'],
      });
    }
    return [...owners.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
  }
}
