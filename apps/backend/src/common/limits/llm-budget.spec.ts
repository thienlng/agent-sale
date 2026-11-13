import { describe, expect, it } from 'vitest';

import { InMemoryLimiter } from './limiter.js';
import { ConversationLlmBudget, LlmBudgetExceededError, OwnerLlmBudget } from './llm-budget.js';

const usage = (tokens: number) => ({ inputTokens: tokens, outputTokens: 0 });

describe('OwnerLlmBudget', () => {
  it('refuses once the account has spent its tokens of the day, and recovers the next day', async () => {
    let now = 0;
    const budget = new OwnerLlmBudget(
      { accountTokensDay: 100, playgroundRunsUserMinute: 0, assistantRunsPerUser: 0 },
      new InMemoryLimiter(() => now),
    );
    await budget.ensureTokens('acc');
    await budget.charge('acc', usage(60));
    await budget.ensureTokens('acc');
    await budget.charge('acc', usage(60));
    await expect(budget.ensureTokens('acc')).rejects.toBeInstanceOf(LlmBudgetExceededError);
    await budget.ensureTokens('other-acc');
    now = 24 * 60 * 60_000;
    await budget.ensureTokens('acc');
  });

  it('rate-limits playground runs per user and minute', async () => {
    let now = 0;
    const budget = new OwnerLlmBudget(
      { accountTokensDay: 0, playgroundRunsUserMinute: 2, assistantRunsPerUser: 0 },
      new InMemoryLimiter(() => now),
    );
    await budget.playgroundRun('acc', 'u1');
    await budget.playgroundRun('acc', 'u1');
    const err = await budget.playgroundRun('acc', 'u1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmBudgetExceededError);
    expect((err as LlmBudgetExceededError).code).toBe('RATE_LIMITED');
    await budget.playgroundRun('acc', 'u2');
    now = 60_000;
    await budget.playgroundRun('acc', 'u1');
  });

  it('bounds the assistant runs one user has in flight; release frees a slot once', async () => {
    const budget = new OwnerLlmBudget(
      { accountTokensDay: 0, playgroundRunsUserMinute: 0, assistantRunsPerUser: 2 },
      new InMemoryLimiter(),
    );
    const a = await budget.assistantRun('acc', 'u1');
    await budget.assistantRun('acc', 'u1');
    await expect(budget.assistantRun('acc', 'u1')).rejects.toBeInstanceOf(LlmBudgetExceededError);
    await budget.assistantRun('acc', 'u2').then((s) => s.release());
    await a.release();
    await a.release();
    await budget.assistantRun('acc', 'u1');
    await expect(budget.assistantRun('acc', 'u1')).rejects.toBeInstanceOf(LlmBudgetExceededError);
  });

  it('is a no-op when every limit is 0', async () => {
    const budget = new OwnerLlmBudget(
      { accountTokensDay: 0, playgroundRunsUserMinute: 0, assistantRunsPerUser: 0 },
      new InMemoryLimiter(),
    );
    await budget.charge('acc', usage(1e9));
    for (let i = 0; i < 50; i++) {
      await budget.playgroundRun('acc', 'u1');
      await budget.assistantRun('acc', 'u1');
    }
  });
});

describe('ConversationLlmBudget', () => {
  it('is exhausted past the hourly calls or tokens of one conversation only', async () => {
    let now = 0;
    const budget = new ConversationLlmBudget(
      { callsPerHour: 3, tokensPerHour: 1000 },
      new InMemoryLimiter(() => now),
    );
    for (let i = 0; i < 3; i++) {
      expect(await budget.exhausted('ws', 'c1')).toBe(false);
      await budget.charge('ws', 'c1', usage(10));
    }
    expect(await budget.exhausted('ws', 'c1')).toBe(true);
    expect(await budget.exhausted('ws', 'c2')).toBe(false);
    await budget.charge('ws', 'c2', usage(1000));
    expect(await budget.exhausted('ws', 'c2')).toBe(true);
    now = 60 * 60_000;
    expect(await budget.exhausted('ws', 'c1')).toBe(false);
  });
});
