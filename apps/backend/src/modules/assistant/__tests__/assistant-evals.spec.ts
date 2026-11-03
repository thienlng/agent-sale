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
  });

  for (const c of cases) {
    it(c.id, async () => {
      const result = await runAssistantCase(c, fakeAssistantModel(c));
      expect(result.problems).toEqual([]);
    });
  }

  it('fails a case whose proposal does not match', async () => {
    const [c] = cases;
    const wrong = structuredClone(c!);
    const input = wrong.fake_turns[0]!.tool_calls[0]!.input as { draft: { channels: string[] } };
    input.draft.channels = ['in_app'];
    const result = await runAssistantCase(wrong, fakeAssistantModel(wrong));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['draft.channels: ["in_app"]']);
  });
});
