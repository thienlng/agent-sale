import { DomainError } from '@agent-sales/shared';

import { getEnv } from '../config.js';
import { sharedLimiter, type Limiter } from './limiter.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Owner-side model spend refused for now (429). Carries no amounts. */
export class LlmBudgetExceededError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor(reason: 'account_tokens_day' | 'user_runs_minute' | 'user_runs_concurrent') {
    super('Too many AI requests for now, please try again later', { reason });
  }
}

/** Token counts of one model call (the gateway's usage). */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Owner-side model budgets (playground and assistant). 0 = off. */
export interface OwnerLlmLimits {
  /** Tokens per account and day, shared by the playground and the assistant. */
  accountTokensDay: number;
  /** Playground runs per user and minute. */
  playgroundRunsUserMinute: number;
  /** Assistant runs one user may have in flight across all threads. */
  assistantRunsPerUser: number;
}

/** A started assistant run: release it when the run ends (also when it fails). */
export interface RunSlot {
  release(): Promise<void>;
}

const ASSISTANT_SLOT_TTL_MS = 15 * MINUTE;

/**
 * Owner-side model spend (security audit 2026-11-12 #15): the account's daily token budget,
 * the playground's per-user rate and the assistant's per-user concurrency, on the shared
 * limiter (Redis in production). Every model call is charged as it completes, so interrupted,
 * failed or undelivered runs count too.
 *
 * Token budgets are check-then-charge (`peek` before the run, `add` after each call), not one
 * atomic step: runs that start together all pass the check, so the total can overshoot the limit
 * by the runs in flight at that moment (each bounded by its own calls; the assistant's per-user
 * slots and the playground's per-minute rate keep that small). Accepted: the token cost of a run
 * is only known after it, so it cannot be reserved up front.
 */
export class OwnerLlmBudget {
  constructor(
    readonly limits: OwnerLlmLimits,
    private readonly limiter: Limiter,
  ) {}

  /** Refuses when the account's tokens of the day are spent. */
  async ensureTokens(accountId: string): Promise<void> {
    const limit = this.limits.accountTokensDay;
    if (!limit) return;
    if ((await this.limiter.peek(this.#tokensKey(accountId))) >= limit)
      throw new LlmBudgetExceededError('account_tokens_day');
  }

  /** Charges one model call's tokens to the account's day. */
  async charge(accountId: string, usage: CallUsage): Promise<void> {
    if (!this.limits.accountTokensDay) return;
    const tokens = Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens);
    if (tokens > 0) await this.limiter.add(this.#tokensKey(accountId), tokens, DAY);
  }

  /** One playground run of the user: refused past the per-minute rate or the day's tokens. */
  async playgroundRun(accountId: string, userId: string): Promise<void> {
    const limit = this.limits.playgroundRunsUserMinute;
    if (limit && !(await this.limiter.hit(`llm:pg:user:${userId}:m`, limit, MINUTE)).ok)
      throw new LlmBudgetExceededError('user_runs_minute');
    await this.ensureTokens(accountId);
  }

  /** Takes one of the user's assistant run slots (refused when all are taken) after the token check. */
  async assistantRun(accountId: string, userId: string): Promise<RunSlot> {
    await this.ensureTokens(accountId);
    const max = this.limits.assistantRunsPerUser;
    if (!max) return { release: async () => undefined };
    const key = `llm:asst:user:${userId}:runs`;
    const slot = await this.limiter.acquire(key, max, ASSISTANT_SLOT_TTL_MS);
    if (!slot) throw new LlmBudgetExceededError('user_runs_concurrent');
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await this.limiter.release(key, slot).catch(() => undefined);
      },
    };
  }

  #tokensKey(accountId: string) {
    return `llm:acct:${accountId}:tokens:d`;
  }
}

/** Off: the budget of tests and tools that build services by hand. */
export const NO_OWNER_LLM_LIMITS: OwnerLlmLimits = {
  accountTokensDay: 0,
  playgroundRunsUserMinute: 0,
  assistantRunsPerUser: 0,
};

/** Nest token of the shared owner budget. */
export const OWNER_LLM_BUDGET = Symbol('OWNER_LLM_BUDGET');

/** Per-conversation model spend of the shop bot (audit #15). 0 = off. */
export interface ConversationLlmLimits {
  callsPerHour: number;
  tokensPerHour: number;
}

/**
 * Model calls and tokens per conversation and hour. Checked before a turn starts (a turn may
 * finish past the limit, by at most its own calls), charged per call as it completes. Same
 * peek-then-add overshoot as the owner budget: one conversation runs one turn at a time (the
 * inbox groups its events), so the overshoot is that turn's own calls.
 */
export class ConversationLlmBudget {
  constructor(
    readonly limits: ConversationLlmLimits,
    private readonly limiter: Limiter,
  ) {}

  async exhausted(ws: string, conversationId: string): Promise<boolean> {
    const { callsPerHour, tokensPerHour } = this.limits;
    if (
      callsPerHour &&
      (await this.limiter.peek(this.#key(ws, conversationId, 'calls'))) >= callsPerHour
    )
      return true;
    return (
      !!tokensPerHour &&
      (await this.limiter.peek(this.#key(ws, conversationId, 'tokens'))) >= tokensPerHour
    );
  }

  async charge(ws: string, conversationId: string, usage: CallUsage): Promise<void> {
    const { callsPerHour, tokensPerHour } = this.limits;
    if (callsPerHour) await this.limiter.add(this.#key(ws, conversationId, 'calls'), 1, HOUR);
    const tokens = Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens);
    if (tokensPerHour && tokens > 0)
      await this.limiter.add(this.#key(ws, conversationId, 'tokens'), tokens, HOUR);
  }

  #key(ws: string, conversationId: string, what: 'calls' | 'tokens') {
    return `llm:conv:${ws}:${conversationId}:${what}:h`;
  }
}

export const CONVERSATION_LLM_BUDGET = Symbol('CONVERSATION_LLM_BUDGET');

/** The owner budget from the environment on the shared limiter. */
export function ownerLlmBudgetFromEnv(): OwnerLlmBudget {
  const env = getEnv();
  return new OwnerLlmBudget(
    {
      accountTokensDay: env.OWNER_LLM_TOKENS_ACCOUNT_DAY,
      playgroundRunsUserMinute: env.PLAYGROUND_RUNS_USER_MINUTE,
      assistantRunsPerUser: env.ASSISTANT_RUNS_PER_USER,
    },
    sharedLimiter(),
  );
}

/** The per-conversation budget from the environment on the shared limiter. */
export function conversationLlmBudgetFromEnv(): ConversationLlmBudget {
  const env = getEnv();
  return new ConversationLlmBudget(
    {
      callsPerHour: env.CONVERSATION_MODEL_CALLS_HOUR,
      tokensPerHour: env.CONVERSATION_TOKENS_HOUR,
    },
    sharedLimiter(),
  );
}
