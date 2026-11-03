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
