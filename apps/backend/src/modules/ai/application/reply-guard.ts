import type { RunnableTool } from '@agent-sales/ai-core';

import { checkReply, type LeakOptions, type ReplyCheck } from '../domain/reply-guard.js';
import { CANCEL_TOOL, CONFIRM_TOOL } from './action-tools.js';
import { HANDOFF_TOOL, SEND_MESSAGE_TOOL } from './output-tools.js';
import { LEGACY_SAAS_REQUEST_TOOL, REQUEST_TOOL } from './request-tools.js';

/**
 * Tools whose result text must not vouch for a figure: the owner's actions (their result may echo
 * model-chosen arguments; only the data they return is trusted, through `trusted`), the request
 * tool (it echoes what the customer said) and the output tools (no data).
 */
const UNTRUSTED_CONTENT = new Set([
  CONFIRM_TOOL,
  CANCEL_TOOL,
  SEND_MESSAGE_TOOL,
  HANDOFF_TOOL,
  REQUEST_TOOL,
  LEGACY_SAAS_REQUEST_TOOL,
]);
const isUntrustedContent = (name: string): boolean =>
  UNTRUSTED_CONTENT.has(name) || name.startsWith('action_');

/**
 * The pre-send guard of one turn (docs/06 §3.3): every `send_message` text and the final reply
 * are checked against the trusted text of the turn (the shop's context plus the tool results so
 * far) and against the shop's private instructions.
 */
export class ReplyGuard {
  readonly #trusted: string[];

  constructor(
    private readonly input: {
      trusted: readonly string[];
      customer: readonly string[];
      secrets: readonly string[];
      leak?: LeakOptions;
      /** The number check (`BOT_REPLY_FIGURE_GUARD`); the leak check always runs. */
      figures: boolean;
    },
  ) {
    this.#trusted = [...input.trusted];
  }

  check(text: string): ReplyCheck {
    return checkReply(text, {
      trusted: this.#trusted,
      customer: this.input.customer,
      secrets: this.input.secrets,
      figures: this.input.figures,
      ...(this.input.leak ? { leak: this.input.leak } : {}),
    });
  }

  /** The tools, recording what each result may vouch for. */
  wrap(tools: readonly RunnableTool[]): RunnableTool[] {
    return tools.map((tool) => ({
      ...tool,
      run: async (input) => {
        const out = await tool.run(input);
        if (out.trusted) this.#trusted.push(out.trusted);
        else if (out.ok !== false && !isUntrustedContent(tool.name))
          this.#trusted.push(out.content);
        return out;
      },
    }));
  }
}
