import { createHash } from 'node:crypto';

import type { ChatMessage } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ActionFacade,
  ActionOutcome,
  BotActionView,
  PendingAction,
} from '../../action/api/index.js';
import type { ModelReply, ParsedModelReply } from '../domain/model-reply.js';
import type { BuiltinInvoker } from './builtin-tools.js';

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
  /** Null when the action module is absent: only built-in tools can run. */
  facade: ActionFacade | null;
  ws: WorkspaceId;
  botId: string;
  /** A UUID: the real conversation, or a stable per-bot id in the playground. */
  conversationId: string;
  isTest: boolean;
  /** Enabled actions of the bot and its built-in tools (the only ones the model may name). */
  actions: readonly BotActionView[];
  /** In-process tools by id (`builtin.*`, never confirm-required): they skip the action module. */
  builtins?: ReadonlyMap<string, BuiltinInvoker> | undefined;
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

type ActionArgs = Record<string, string | number | boolean>;

/** Same write inside the same 10 minute bucket is the same logical write, whichever event retries it. */
const IDEMPOTENCY_BUCKET_MS = 10 * 60 * 1000;

/**
 * Key of a write: conversation + action + hash of the canonical (sorted) args + 10 minute bucket.
 * Independent of the channel event, so a requeued or superseded event answering the same burst
 * sends the same key and the remote API can drop the duplicate.
 */
export function idempotencyKey(
  conversationId: string,
  actionId: string,
  args: ActionArgs,
  now: number = Date.now(),
): string {
  const canonical = JSON.stringify(Object.entries(args).sort(([a], [b]) => (a < b ? -1 : 1)));
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `act:${conversationId}:${actionId}:${hash}:${Math.floor(now / IDEMPOTENCY_BUCKET_MS)}`;
}

/** Errors worth a retry by the customer: the write may well not have happened. */
const TRANSIENT_ERRORS = new Set(['timeout', 'network']);

const escapeRegExp = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Values of `args` that appear as a whole token in `texts` (the customer's words or trusted results). */
function vouchedValues(args: ActionArgs, texts: readonly string[]): string[] {
  return Object.values(args)
    .map(String)
    .filter((value) =>
      texts.some((t) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, 'iu').test(t),
      ),
    );
}

const ACTION_OUTCOMES = new Set(['call_action', 'confirm_action', 'cancel_action']);

/** A stable UUID for the playground, which has no conversation: lets confirmations work in tests. */
export function playgroundConversationId(botId: string): string {
  const h = createHash('sha1').update(`playground:${botId}`).digest('hex');
  const variant = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** JSON for the model that cannot close the `<action_result>` tag early. */
export function safeJson(value: unknown): string {
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
      await facade?.clearPending(ws, conversationId);
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
      pending = facade ? await facade.consumePending(ws, conversationId) : null;
      if (!pending) return fallback(null);
      action = input.actions.find((a) => a.id === pending?.actionId);
      if (!action) return fallback(null);
      args = pending.args;
    } else {
      action = input.actions.find((a) => a.id === reply.actionId);
      if (!action) return fallback(null);
      args = reply.args ?? {};
      if (action.requiresConfirm) {
        if (!reply.reply.trim() || !facade) return fallback(null);
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
    const builtin = input.builtins?.get(action.id);
    let outcome: ActionOutcome;
    if (builtin) outcome = await builtin(args);
    else if (facade)
      outcome = await facade.invoke(ws, botId, {
        actionId: action.id,
        args,
        conversationId,
        idempotencyKey: input.keyFor(action.id, args),
        isTest: input.isTest,
      });
    else return fallback(null);
    // The write may not have happened: let the customer say "ok" again instead of losing the call.
    if (facade && pending && !outcome.ok && TRANSIENT_ERRORS.has(outcome.errorCode)) {
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
