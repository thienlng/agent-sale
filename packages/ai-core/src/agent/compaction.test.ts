import { describe, expect, it } from 'vitest';
import {
  COMPACTION_SUMMARY_PREFIX,
  PRUNED_TOOL_TEXT,
  buildCompactionPrompt,
  planCompaction,
  shouldCompact,
  type CompactionMessage,
} from './compaction.js';

let seq = 0;
const m = (
  role: CompactionMessage['role'],
  content = `${role} text`,
  extra: Partial<CompactionMessage> = {},
): CompactionMessage => ({
  id: `m${seq++}`,
  role,
  content,
  isSummary: false,
  ...extra,
});
/** n user/assistant pairs. */
const pairs = (n: number) => Array.from({ length: n }, () => [m('user'), m('assistant')]).flat();

describe('constants', () => {
  it('match the spec', () => {
    expect(PRUNED_TOOL_TEXT).toBe('[tool output cleared — use session_search]');
    expect(COMPACTION_SUMMARY_PREFIX).toBe(
      "REFERENCE ONLY — summary of earlier conversation. The owner's latest message wins.\n\n",
    );
  });
});

describe('shouldCompact', () => {
  const base = { contextTokens: 128_000, maxOutputTokens: 16_000, activeMessages: 10 };
  it('triggers at 75 % of the usable window', () => {
    expect(shouldCompact({ ...base, lastInputTokens: 83_999 })).toBe(false);
    expect(shouldCompact({ ...base, lastInputTokens: 84_000 })).toBe(true);
  });
  it('triggers above 80 active messages', () => {
    expect(shouldCompact({ ...base, lastInputTokens: 0, activeMessages: 80 })).toBe(false);
    expect(shouldCompact({ ...base, lastInputTokens: 0, activeMessages: 81 })).toBe(true);
  });
});

describe('planCompaction', () => {
  it('returns null for short threads', () => {
    expect(planCompaction(pairs(5))).toBeNull();
    // head 3 + middle 5 + tail 20 → still too short
    expect(
      planCompaction([m('user'), m('assistant'), m('user'), ...pairs(2), m('event'), ...pairs(10)]),
    ).toBeNull();
  });

  it('keeps head 3, a tail of ≥ 20 that starts at a user message, and summarises the middle', () => {
    const msgs = pairs(20); // 40 messages
    const plan = planCompaction(msgs)!;
    expect(plan.keepHeadIds).toEqual(msgs.slice(0, 3).map((x) => x.id));
    expect(plan.keepTailIds).toEqual(msgs.slice(20).map((x) => x.id));
    expect(plan.summarizeIds).toEqual(msgs.slice(3, 20).map((x) => x.id));
    expect(plan.previousSummary).toBeNull();
    expect(plan.pruneToolIds).toEqual([]);
  });

  it('moves the tail start back to a user message so tool results stay with their call', () => {
    const head = [m('user'), m('assistant'), m('user')];
    const middle = pairs(4);
    const call = [
      m('user'),
      m('assistant', '', { toolCalls: [{ id: 't', name: 'x' }] }),
      m('tool'),
      m('tool'),
    ];
    const rest = [m('assistant'), ...pairs(8)]; // 17 messages
    const msgs = [...head, ...middle, ...call, ...rest]; // n - 20 lands on the second tool message
    const plan = planCompaction(msgs)!;
    const first = msgs.find((x) => x.id === plan.keepTailIds[0])!;
    expect(first.role).toBe('user');
    expect(first.id).toBe(call[0]!.id);
    expect(plan.keepTailIds.length).toBeGreaterThanOrEqual(20);
    expect(plan.summarizeIds).toEqual(middle.map((x) => x.id));
  });

  it('accepts an event message as the tail start', () => {
    const msgs = [...pairs(8), m('event'), m('user'), ...pairs(9)]; // 36 messages, n - 20 = the event
    const plan = planCompaction(msgs)!;
    expect(msgs[16]!.role).toBe('event');
    expect(plan.keepTailIds).toEqual(msgs.slice(16).map((x) => x.id));
  });

  it('walks back past an event when the tail after it has no user message', () => {
    const msgs = [...pairs(8), m('event'), ...Array.from({ length: 19 }, () => m('assistant'))];
    const plan = planCompaction(msgs)!;
    const tail = msgs.filter((x) => plan.keepTailIds.includes(x.id));
    expect(tail.some((x) => x.role === 'user')).toBe(true);
    expect(tail[0]!.role).toBe('user');
  });

  it('folds an existing summary into the middle', () => {
    const head = [m('user'), m('assistant'), m('user')];
    const summary = m('assistant', `${COMPACTION_SUMMARY_PREFIX}## Goal\nold`, { isSummary: true });
    const msgs = [...head, summary, ...pairs(15)];
    const plan = planCompaction(msgs)!;
    expect(plan.keepHeadIds).toEqual(head.map((x) => x.id));
    expect(plan.previousSummary).toBe('## Goal\nold');
    expect(plan.summarizeIds[0]).toBe(summary.id);
    expect(plan.keepTailIds).not.toContain(summary.id);
  });

  it('skips a leading summary when picking the head', () => {
    const summary = m('assistant', 'old summary', { isSummary: true });
    const msgs = [summary, ...pairs(20)];
    const plan = planCompaction(msgs)!;
    expect(plan.keepHeadIds).toEqual(msgs.slice(1, 4).map((x) => x.id));
    expect(plan.previousSummary).toBe('old summary');
  });

  it('prunes long tool results that stay active, not the summarised ones', () => {
    const long = () => m('tool', 'x'.repeat(201));
    const headTool = long();
    const head = [m('user'), m('assistant', '', { toolCalls: [] }), headTool];
    const middleTool = long();
    const middle = [m('user'), m('assistant', '', { toolCalls: [] }), middleTool, ...pairs(3)];
    const olderTailTool = long();
    const shortTailTool = m('tool', 'x'.repeat(200));
    const recentTailTool = long();
    const tail = [
      m('user'),
      m('assistant', '', { toolCalls: [] }),
      olderTailTool,
      shortTailTool,
      ...pairs(4), // 12 messages so far; the last 10 of the tail start below
      m('user'),
      m('assistant', '', { toolCalls: [] }),
      recentTailTool,
      ...pairs(3),
      m('assistant'),
    ];
    const msgs = [...head, ...middle, ...tail];
    const plan = planCompaction(msgs, { tailMinMessages: tail.length })!;
    expect(plan.keepTailIds).toEqual(tail.map((x) => x.id));
    expect(plan.summarizeIds).toContain(middleTool.id);
    expect(plan.pruneToolIds).toEqual([headTool.id, olderTailTool.id]);
  });
});

describe('buildCompactionPrompt', () => {
  const sections = [
    'Goal',
    'Owner preferences and constraints',
    'Completed actions',
    'Pending proposals',
    'Key decisions',
    'Figures already given (with source tool)',
    'Open questions',
  ];

  it('asks for the fixed sections in order, in the owner language, and cuts tool output', () => {
    const p = buildCompactionPrompt(null, [
      m('user', 'Doanh thu tháng này?'),
      m('tool', 'y'.repeat(800)),
    ]);
    let at = -1;
    for (const s of sections) {
      const next = p.system.indexOf(`## ${s}`);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    expect(p.system).toContain('N. ACTION target — outcome [tool]');
    expect(p.system).toContain("owner's language");
    expect(p.system).not.toContain('update it');
    expect(p.user).toContain('Doanh thu tháng này?');
    expect(p.user).toContain(`${'y'.repeat(500)}…`);
    expect(p.user).not.toContain('y'.repeat(501));
    expect(p.user).not.toContain('<previous_summary>');
  });

  it('asks to update a previous summary instead of restarting', () => {
    const p = buildCompactionPrompt('## Goal\nold', [m('user', 'tiếp')]);
    expect(p.system).toContain('update it');
    expect(p.system).toContain('Do not start over');
    expect(p.user).toContain('<previous_summary>\n## Goal\nold\n</previous_summary>');
  });
});
