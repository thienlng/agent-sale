import { describe, expect, it } from 'vitest';

import {
  fakeAssistantModel,
  loadAssistantCases,
  runAssistantCase,
} from '../evals/assistant-eval.js';

/** `pnpm test` runs every owner assistant eval case with its scripted model (T-172). */
describe('owner assistant evals (fake model)', () => {
  const cases = loadAssistantCases();

  it('loads the cases', () => {
    expect(cases.map((c) => c.id)).toContain('schedule-weekly-revenue-email');
    // The request verticals (T-187).
    expect(cases.map((c) => c.id)).toEqual(
      expect.arrayContaining(['schedule-new-requests-alert', 'data-requests-by-status']),
    );
  });

  for (const c of cases) {
    it(c.id, async () => {
      const result = await runAssistantCase(c, fakeAssistantModel(c));
      expect(result.problems).toEqual([]);
    });
  }

  it('fails a case whose proposal does not match', async () => {
    const c = cases.find((x) => x.id === 'schedule-weekly-revenue-email');
    const wrong = structuredClone(c!);
    const input = wrong.fake_turns[0]!.tool_calls[0]!.input as { draft: { channels: string[] } };
    input.draft.channels = ['in_app'];
    const result = await runAssistantCase(wrong, fakeAssistantModel(wrong));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['draft.channels: ["in_app"]']);
  });

  it('checks the answer text, the tool results and the UI actions (staging wave 1)', async () => {
    const hold = cases.find((x) => x.id === 'hotel-hold-expiry-local-time')!;
    const wrong = structuredClone(hold);
    wrong.fake_turns[1]!.text = 'Dạ BK-0012 giữ chỗ đến 20:05 ngày 12/11, đã qua rồi ạ.';
    const out = await runAssistantCase(wrong, fakeAssistantModel(wrong));
    expect(out.problems).toEqual(['answer: missing "03:05"', 'answer: has "20:05"']);

    const raw = structuredClone(hold);
    raw.expect.tool_results = { contains: ['20:05:39.000Z'], not_contains: [] };
    expect((await runAssistantCase(raw, fakeAssistantModel(raw))).problems).toEqual([
      'tool_results: missing "20:05:39.000Z"',
    ]);

    const nav = structuredClone(cases.find((x) => x.id === 'data-question-no-navigate')!);
    nav.fake_turns.splice(1, 0, {
      text: '',
      tool_calls: [{ name: 'ui_navigate', input: { to: '/app/orders' } }],
    });
    expect((await runAssistantCase(nav, fakeAssistantModel(nav))).problems).toEqual([
      'ui action navigate on the answer',
    ]);
  });

  it('fails a case whose SQL does not match', async () => {
    const c = cases.find((x) => x.id === 'data-requests-by-status');
    const wrong = structuredClone(c!);
    const input = wrong.fake_turns[0]!.tool_calls[0]!.input as { body: { sql: string } };
    input.body.sql = 'select count(*) as n from customers';
    const result = await runAssistantCase(wrong, fakeAssistantModel(wrong));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/^sql: no query contains/);
  });
});
