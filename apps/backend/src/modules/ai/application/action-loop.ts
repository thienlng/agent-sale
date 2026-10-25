import { createHash } from 'node:crypto';

import type { ChatMessage } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';

import type { ActionFacade, BotActionView } from '../../action/api/index.js';
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
  /** Idempotency key of a call to `actionId`; `n` counts earlier calls of it in this turn. */
  keyFor(actionId: string, n: number): string;
}

const ACTION_OUTCOMES = new Set(['call_action', 'confirm_action', 'cancel_action']);

/** A stable UUID for the playground, which has no conversation: lets confirmations work in tests. */
export function playgroundConversationId(botId: string): string {
  const h = createHash('sha1').update(`playground:${botId}`).digest('hex');
  const variant = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** JSON for the model that cannot close the `<action_result>` tag early. */
function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replaceAll('<', '\\u003c');
}

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
  const executedCount = new Map<string, number>();
  const fallback = (guardrail: string | null): ActionLoopResult => ({
    kind: 'fallback',
    guardrail,
    calls,
  });
  let turn = input.first;
  let executed = 0;

  for (;;) {
    if (!turn.output.ok || !ACTION_OUTCOMES.has(turn.output.value.outcome)) {
      return { kind: 'turn', turn, results, readback: [], calls };
    }
    const reply = turn.output.value;

    if (reply.outcome === 'cancel_action') {
      await facade.clearPending(ws, conversationId);
      return {
        kind: 'turn',
        turn: { ...turn, output: asAnswer(reply) },
        results,
        readback: [],
        calls,
      };
    }

    let action: BotActionView | undefined;
    let args: Record<string, string | number | boolean>;
    const confirmed = reply.outcome === 'confirm_action';
    if (confirmed) {
      // Never the model's arguments: only what was stored when the customer was asked.
      const pending = await facade.getPending(ws, conversationId);
      if (!pending) return fallback(null);
      action = input.actions.find((a) => a.id === pending.actionId);
      if (!action) {
        await facade.clearPending(ws, conversationId);
        return fallback(null);
      }
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
          readback: Object.values(args).map(String),
          calls,
        };
      }
    }

    if (executed >= MAX_ACTION_ROUNDS) return fallback('action_loop_limit');
    executed += 1;
    const n = executedCount.get(action.id) ?? 0;
    executedCount.set(action.id, n + 1);
    const outcome = await facade.invoke(ws, botId, {
      actionId: action.id,
      args,
      conversationId,
      idempotencyKey: input.keyFor(action.id, n),
      isTest: input.isTest,
    });
    if (confirmed) await facade.clearPending(ws, conversationId);

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
