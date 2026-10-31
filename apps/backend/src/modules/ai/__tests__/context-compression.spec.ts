import type { ChatMessage, GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { createHistorySummarizer } from '../application/history-summarizer.js';
import { InMemoryConversationSummaryRepository } from '../infrastructure/persistence/conversation-summary.drizzle.js';
import {
  COMPRESS_AT_CHARS,
  COMPRESS_AT_TURNS,
  KEEP_LAST_TURNS,
  compressHistory,
  needsCompression,
} from '../application/context-compression.js';
import { compactHistory } from '../application/reply-context.js';

const turn = (i: number, size = 10): ChatMessage => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `t${i}:`.padEnd(size, 'x'),
});
const turns = (n: number, size = 10) => Array.from({ length: n }, (_, i) => turn(i, size));

describe('needsCompression', () => {
  it('triggers strictly above the threshold', () => {
    expect(COMPRESS_AT_CHARS).toBe(24_000);
    expect(KEEP_LAST_TURNS).toBe(12);
    expect(needsCompression([{ role: 'user', content: 'x'.repeat(24_000) }])).toBe(false);
    expect(needsCompression([{ role: 'user', content: 'x'.repeat(24_001) }])).toBe(true);
    expect(needsCompression(turns(3, 10), { maxChars: 29 })).toBe(true);
  });

  it('also triggers on more than 30 turns, and counts the stored summary in the budget', () => {
    expect(COMPRESS_AT_TURNS).toBe(30);
    expect(needsCompression(turns(30))).toBe(false);
    expect(needsCompression(turns(31))).toBe(true);
    expect(needsCompression(turns(3, 10), { summary: 'x'.repeat(23_971) })).toBe(true);
    expect(needsCompression(turns(3, 10), { summary: 'x'.repeat(23_970) })).toBe(false);
  });
});

describe('compressHistory', () => {
  it('leaves short histories untouched', async () => {
    const summarize = vi.fn();
    const out = await compressHistory(turns(20), { summarize, stored: null });
    expect(out.turns).toEqual(turns(20));
    expect(out.summary).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it('keeps the last 12 turns verbatim behind one summary user message', async () => {
    const all = turns(30, 100);
    const summarize = vi.fn(async () => 'SUM');
    const out = await compressHistory(all, { summarize, stored: null, maxChars: 1000 });
    expect(out.turns).toHaveLength(13);
    expect(out.turns[0]).toEqual({
      role: 'user',
      content: '<earlier_conversation_summary>\nSUM\n</earlier_conversation_summary>',
    });
    expect(out.turns.slice(1)).toEqual(all.slice(18));
    expect(out.summary).toEqual({ coveredUntilIndex: 18, summary: 'SUM' });
    const [text, previous] = summarize.mock.calls[0] as unknown as [string, string | null];
    expect(previous).toBeNull();
    expect(text).toContain('t0:');
    expect(text).toContain('t17:');
    expect(text).not.toContain('t18:');
  });

  it('summarises incrementally: only newly fallen-out turns plus the previous summary', async () => {
    const all = turns(40, 100);
    const summarize = vi.fn(async () => 'SUM2');
    const out = await compressHistory(all, {
      summarize,
      stored: { coveredUntilIndex: 18, summary: 'SUM1' },
      maxChars: 1000,
    });
    const [text, previous] = summarize.mock.calls[0] as unknown as [string, string | null];
    expect(previous).toBe('SUM1');
    expect(text).toContain('t18:');
    expect(text).toContain('t27:');
    expect(text).not.toContain('t17:');
    expect(text).not.toContain('t28:');
    expect(out.summary).toEqual({ coveredUntilIndex: 28, summary: 'SUM2' });
    expect(out.turns.slice(1)).toEqual(all.slice(28));
  });

  it('compresses a long run of short turns (turn count) and keeps the last 12 verbatim', async () => {
    const summarize = vi.fn(async () => 'SUM');
    const short = await compressHistory(turns(30), { summarize, stored: null });
    expect(short.summary).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
    const all = turns(31);
    const out = await compressHistory(all, { summarize, stored: null });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(out.summary).toEqual({ coveredUntilIndex: 19, summary: 'SUM' });
    expect(out.turns.slice(1)).toEqual(all.slice(19));
  });

  it('re-summarises once the turns the summary does not cover exceed 30, merging all of them', async () => {
    const all = turns(50);
    const summarize = vi.fn(async () => 'SUM2');
    // 31 uncovered short turns: well under the character budget, but over the turn count.
    const out = await compressHistory(all, {
      summarize,
      stored: { coveredUntilIndex: 19, summary: 'SUM1' },
    });
    const [text, previous] = summarize.mock.calls[0] as unknown as [string, string | null];
    expect(previous).toBe('SUM1');
    // Every turn between the old summary and the kept window, none skipped.
    expect(text.split('\n').map((l) => l.split(':')[1])).toEqual(
      Array.from({ length: 19 }, (_, i) => ` t${19 + i}`),
    );
    expect(out.summary).toEqual({ coveredUntilIndex: 38, summary: 'SUM2' });
  });

  it('reuses the stored summary when nothing new fell out of the kept window', async () => {
    const all = turns(40, 10);
    const summarize = vi.fn();
    // Over the character budget, but the summary already covers everything before the window.
    const out = await compressHistory(all, {
      summarize,
      stored: { coveredUntilIndex: 28, summary: 'SUM1' },
      maxChars: 100,
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(out.summary).toEqual({ coveredUntilIndex: 28, summary: 'SUM1' });
    expect(out.turns.slice(1)).toEqual(all.slice(28));
  });

  it('leaves no gap while a long chat slides through the 100-turn window', async () => {
    const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60_000);
    const covered = new Set<string>();
    let saved: { coveredUntil: Date; summary: string } | null = null;
    const summarize = async (text: string, previous: string | null) => {
      for (const line of text.split('\n')) covered.add(line.split(':')[1]!.trim());
      return `note ${previous ? Number(previous.split(' ')[1]) + 1 : 1}`;
    };
    for (let n = 1; n <= 260; n++) {
      // What the channel passes: the last 100 turns with their times.
      const all = turns(n).slice(-100);
      const times = Array.from({ length: n }, (_, i) => at(i)).slice(-100);
      const out = await compactHistory(all, {
        times,
        stored: saved,
        summarize,
        onError: (error) => {
          throw error;
        },
      });
      if (out.save) saved = out.save;
      const kept = out.turns
        .filter((t) => !t.content.startsWith('<earlier_conversation_summary>'))
        .map((t) => t.content.split(':')[0]!);
      for (let i = 0; i < n; i++) expect(covered.has(`t${i}`) || kept.includes(`t${i}`)).toBe(true);
      expect(out.turns.length).toBeLessThanOrEqual(COMPRESS_AT_TURNS + 1);
    }
  });

  it('reuses the stored summary without a model call while the rest still fits', async () => {
    const all = turns(30, 100);
    const summarize = vi.fn();
    const out = await compressHistory(all, {
      summarize,
      stored: { coveredUntilIndex: 18, summary: 'SUM1' },
      maxChars: 5000,
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(out.turns).toHaveLength(13);
    expect(out.summary).toEqual({ coveredUntilIndex: 18, summary: 'SUM1' });
  });
});

describe('createHistorySummarizer', () => {
  it('asks the given tier, without tools, and merges the previous note', async () => {
    const generate = vi.fn(
      async (_req: GenerateRequest) => ({ text: '  note  ' }) as GenerateResponse,
    );
    const ws = workspaceId('00000000-0000-4000-8000-000000000001');
    const summarize = createHistorySummarizer(generate, { workspaceId: ws, tier: 'pro' });
    expect(await summarize('Customer: hi', 'old note')).toBe('note');
    const req = generate.mock.calls[0]?.[0] as GenerateRequest;
    expect(req.tier).toBe('pro');
    expect(req.workspaceId).toBe(ws);
    expect(req.tools).toBeUndefined();
    // Bounded: a slow summary must not eat the turn's budget (the caller falls back on failure).
    expect(req.timeoutMs).toBe(20_000);
    const prompt = req.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('old note');
    expect(prompt).toContain('Customer: hi');
    expect(prompt).toContain('phone numbers');
  });

  it('keeps the full turns when the summary call times out', async () => {
    const all = turns(40);
    const onError = vi.fn();
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const out = await compactHistory(all, {
      times: null,
      stored: null,
      summarize: async () => Promise.reject(timeout),
      onError,
    });
    expect(out).toEqual({ turns: all, save: null });
    expect(onError).toHaveBeenCalledWith(timeout);
  });

  it('throws on an empty note so the caller keeps the full turns', async () => {
    const generate = vi.fn(async () => ({ text: '  \n ' }) as GenerateResponse);
    const summarize = createHistorySummarizer(generate, {
      workspaceId: workspaceId('00000000-0000-4000-8000-000000000001'),
      tier: 'basic',
    });
    await expect(summarize('x', null)).rejects.toThrow(/empty/);
  });

  it('cuts an over-long note at the last line break before 1500 characters', async () => {
    const line = 'b'.repeat(99);
    const text = Array.from({ length: 30 }, () => line).join('\n');
    const generate = vi.fn(async () => ({ text }) as GenerateResponse);
    const summarize = createHistorySummarizer(generate, {
      workspaceId: workspaceId('00000000-0000-4000-8000-000000000001'),
      tier: 'basic',
    });
    const out = await summarize('x', null);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out.split('\n').every((l) => l === line)).toBe(true);
    const req = generate.mock.calls[0] as unknown as [GenerateRequest];
    expect(req[0].messages[0]?.content).toContain('1200');
  });
});

describe('InMemoryConversationSummaryRepository', () => {
  it('stores per workspace and conversation, overwriting on put', async () => {
    const repo = new InMemoryConversationSummaryRepository();
    const a = workspaceId('00000000-0000-4000-8000-00000000000a');
    const b = workspaceId('00000000-0000-4000-8000-00000000000b');
    expect(await repo.get(a, 'c1')).toBeNull();
    await repo.put(a, 'c1', { coveredUntil: new Date(1), summary: 'one' });
    await repo.put(a, 'c1', { coveredUntil: new Date(2), summary: 'two' });
    expect(await repo.get(a, 'c1')).toEqual({ coveredUntil: new Date(2), summary: 'two' });
    expect(await repo.get(b, 'c1')).toBeNull();
    expect(await repo.get(a, 'c2')).toBeNull();
  });
});
