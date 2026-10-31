import type { ChatMessage, GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { createHistorySummarizer } from '../application/history-summarizer.js';
import {
  COMPRESS_AT_CHARS,
  KEEP_LAST_TURNS,
  compressHistory,
  needsCompression,
} from '../domain/context-compression.js';

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
    expect(needsCompression(turns(3, 10), 29)).toBe(true);
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
    const prompt = req.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('old note');
    expect(prompt).toContain('Customer: hi');
    expect(prompt).toContain('phone numbers');
  });

  it('caps the note at 1500 characters', async () => {
    const generate = vi.fn(async () => ({ text: 'a'.repeat(3000) }) as GenerateResponse);
    const summarize = createHistorySummarizer(generate, {
      workspaceId: workspaceId('00000000-0000-4000-8000-000000000001'),
      tier: 'basic',
    });
    expect((await summarize('x', null)).length).toBe(1500);
  });
});
