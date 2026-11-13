import type { RunnableTool } from '@agent-sales/ai-core';

import { localizeInstantsInJson } from '../domain/local-time.js';

/**
 * Every tool result of the turn shows its instants on the owner's clock (AS-3): a hold that
 * expires at `2026-11-12T20:05:39Z` reads `2026-11-13T03:05:39+07:00`, so the model never
 * reports a UTC hour as local time. The route tools turn the offsets back into UTC on writes.
 */
export function withLocalTimes(tools: readonly RunnableTool[]): RunnableTool[] {
  return tools.map((tool) => ({
    ...tool,
    async run(input) {
      const out = await tool.run(input);
      return { ...out, content: localizeInstantsInJson(out.content) };
    },
  }));
}
