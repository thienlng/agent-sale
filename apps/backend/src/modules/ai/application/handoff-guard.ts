import type { RunnableTool } from '@agent-sales/ai-core';

import { handoffVerdict, type HandoffVerdict } from '../domain/handoff-guard.js';
import { safeJson } from './action-tools.js';
import { HANDOFF_TOOL } from './output-tools.js';

/** The customer's newest messages: every customer message after the shop's last reply. */
export function latestCustomerBlock(
  messages: readonly { role: string; content: string }[],
): string {
  const block: string[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'customer') break;
    block.unshift(m.content);
  }
  return block.join('\n');
}

/**
 * Wraps the turn's `handoff` tool with the handoff guard (VL2-1, `domain/handoff-guard.ts`): a
 * refused call returns a tool error naming what to do instead and never reaches the output state,
 * so the agent loop goes on (a refused call is not terminal). The ok results of the other tools
 * this turn join the shop text the guard reads policy facts from.
 */
export function guardHandoff(
  tools: readonly RunnableTool[],
  opts: {
    customerText: string;
    /** The customer's last few messages (DEC-2: an earlier complaint still lets staff in). */
    recentCustomerText?: string;
    offeredTools: readonly string[];
    /** The shop's text in the model's context (profile, focus products, knowledge). */
    shopText: string;
    /** Called for each verdict (traces and logs; never the customer's text). */
    onVerdict?: (verdict: HandoffVerdict) => void;
  },
): RunnableTool[] {
  const results: string[] = [];
  let refused = 0;
  return tools.map((tool) => {
    if (tool.name !== HANDOFF_TOOL)
      return {
        ...tool,
        run: async (input) => {
          const out = await tool.run(input);
          if (out.ok !== false) results.push(out.content);
          return out;
        },
      };
    return {
      ...tool,
      run: async (input) => {
        const reason =
          typeof (input as { reason?: unknown } | null)?.reason === 'string'
            ? (input as { reason: string }).reason
            : '';
        const verdict = handoffVerdict({
          reason,
          customerText: opts.customerText,
          ...(opts.recentCustomerText ? { recentCustomerText: opts.recentCustomerText } : {}),
          offeredTools: opts.offeredTools,
          shopText: [opts.shopText, ...results].join('\n'),
          refused,
        });
        opts.onVerdict?.(verdict);
        if (verdict.allow) return tool.run(input);
        refused += 1;
        return {
          content: safeJson({
            ok: false,
            errorCode: verdict.code,
            topic: verdict.topic,
            ...(verdict.tool ? { useTool: verdict.tool } : {}),
            hint: verdict.hint,
          }),
          ok: false,
        };
      },
    };
  });
}
