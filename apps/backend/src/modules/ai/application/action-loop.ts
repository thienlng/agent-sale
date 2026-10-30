import type { ChatMessage } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';

import type { ActionFacade, BotActionView, PendingAction } from '../../action/api/index.js';
import type { ModelReply, ParsedModelReply } from '../domain/model-reply.js';

/** Executions per customer turn (a 4th requested call ends in the fallback). */
export const MAX_ACTION_ROUNDS = 3;

/** One model completion, already retried/salvaged by the caller. */
export interface ModelTurn {
  text: string;
  output: ParsedModelReply;
}

/** What the response exposes about a call: the action's name, never its arguments or data. */
export interface ActionCall {
  name: string;
  ok: boolean;
  statusCode: number | null;
}

export type ActionLoopResult =
  | {
      kind: 'turn';
      /** The turn to run through the guardrails (action outcomes are already resolved). */
      turn: ModelTurn;
      /** `data` of this turn's results as JSON text: figures in them are trusted. */
      results: string[];
      /** Values the customer agreed to read back in a confirmation question: vouch for figures. */
      readback: string[];
      /** A confirmation question was stored this turn: it must reach the customer or be dropped. */
      askedConfirmation: boolean;
      calls: ActionCall[];
    }
  | { kind: 'fallback'; guardrail: string | null; calls: ActionCall[] };

export interface ActionLoopInput {
  facade: ActionFacade;
  ws: WorkspaceId;
  botId: string;
  /** A UUID: the real conversation, or a stable per-bot id in the playground. */
  conversationId: string;
  isTest: boolean;
  /** Enabled actions of the bot (the only ones the model may name). */
  actions: readonly BotActionView[];
  first: ModelTurn;
  /** Next model turn given the messages to append after the base conversation. */
  ask(followUp: ChatMessage[]): Promise<ModelTurn>;
  /** Last user message of a follow-up: reminds the model of the output format. */
  reminder: string;
  /** What the customer wrote this turn: the only text (besides trusted results) that vouches for an argument. */
  customerTexts: readonly string[];
  /** Idempotency key of a call: stable for the same logical write (see `idempotencyKey`). */
  keyFor(actionId: string, args: ActionArgs): string;
}

/** Re-exported until the reply pipeline moves to tool calling. */
export { idempotencyKey, playgroundConversationId, safeJson } from './action-tools.js';
import { safeJson, vouchedValues, type ActionArgs } from './action-tools.js';

const TRANSIENT_ERRORS = new Set(['timeout', 'network']);

const ACTION_OUTCOMES = new Set(['call_action', 'confirm_action', 'cancel_action']);

const asAnswer = (value: ModelReply): ParsedModelReply => ({
  ok: true,
  value: { outcome: 'answer', reply: value.reply, sources: [], imageIds: [] },
});

/**
 * Resolves the action outcomes of the model (docs/actions.md): at most `MAX_ACTION_ROUNDS` calls
 * per customer turn; a call that needs confirmation is only stored (the customer is asked, the
 * model's reply is the question) and runs, with the STORED arguments, when the customer agrees.
 * The model never reaches the network: it names an id from its own list, the server does the rest.
 */
export async function runActionLoop(input: ActionLoopInput): Promise<ActionLoopResult> {
  const { facade, ws, botId, conversationId } = input;
  const calls: ActionCall[] = [];
  const results: string[] = [];
  const followUp: ChatMessage[] = [];
  const fallback = (guardrail: string | null): ActionLoopResult => ({
    kind: 'fallback',
    guardrail,
    calls,
  });
  let turn = input.first;
  let executed = 0;

  for (;;) {
    if (!turn.output.ok || !ACTION_OUTCOMES.has(turn.output.value.outcome)) {
      return { kind: 'turn', turn, results, readback: [], askedConfirmation: false, calls };
    }
    const reply = turn.output.value;

    if (reply.outcome === 'cancel_action') {
      await facade.clearPending(ws, conversationId);
      return {
        kind: 'turn',
        turn: { ...turn, output: asAnswer(reply) },
        results,
        readback: [],
        askedConfirmation: false,
        calls,
      };
    }

    let action: BotActionView | undefined;
    let pending: PendingAction | null = null;
    let args: Record<string, string | number | boolean>;
    const confirmed = reply.outcome === 'confirm_action';
    if (confirmed) {
      // Never the model's arguments: only what was stored when the customer was asked.
      if (executed >= MAX_ACTION_ROUNDS) return fallback('action_loop_limit');
      // Atomic take BEFORE the call: of two concurrent confirmations only one gets the stored write.
      pending = await facade.consumePending(ws, conversationId);
      if (!pending) return fallback(null);
      action = input.actions.find((a) => a.id === pending?.actionId);
      if (!action) return fallback(null);
      args = pending.args;
    } else {
      action = input.actions.find((a) => a.id === reply.actionId);
      if (!action) return fallback(null);
      args = reply.args ?? {};
      if (action.requiresConfirm) {
        if (!reply.reply.trim()) return fallback(null);
        await facade.setPending(ws, conversationId, { actionId: action.id, args });
        return {
          kind: 'turn',
          turn: { ...turn, output: asAnswer(reply) },
          results,
          readback: vouchedValues(args, [...input.customerTexts, ...results]),
          askedConfirmation: true,
          calls,
        };
      }
    }

    if (executed >= MAX_ACTION_ROUNDS) return fallback('action_loop_limit');
    executed += 1;
    const outcome = await facade.invoke(ws, botId, {
      actionId: action.id,
      args,
      conversationId,
      idempotencyKey: input.keyFor(action.id, args),
      isTest: input.isTest,
    });
    // The write may not have happened: let the customer say "ok" again instead of losing the call.
    if (pending && !outcome.ok && TRANSIENT_ERRORS.has(outcome.errorCode)) {
      await facade.setPending(ws, conversationId, { actionId: pending.actionId, args });
    }

    calls.push({
      name: action.name,
      ok: outcome.ok,
      statusCode: outcome.statusCode ?? null,
    });
    const visible = outcome.ok
      ? { ok: true, statusCode: outcome.statusCode, data: outcome.data }
      : { ok: false, errorCode: outcome.errorCode };
    if (outcome.ok) results.push(safeJson(outcome.data));
    followUp.push(
      { role: 'assistant', content: turn.text },
      {
        role: 'user',
        content: `<action_result>\n${safeJson(visible)}\n</action_result>\n\n${input.reminder}`,
      },
    );
    turn = await input.ask([...followUp]);
  }
}
