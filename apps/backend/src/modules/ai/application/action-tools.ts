import { createHash } from 'node:crypto';

import type { ToolCall, ToolDefinition } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';

import type { ActionFacade, BotActionView, PendingAction } from '../../action/api/index.js';

/** Executions per customer turn (a 4th requested call ends in the fallback). */
export const MAX_ACTION_ROUNDS = 3;

export type ActionArgs = Record<string, string | number | boolean>;

/** What the response exposes about a call: the action's name, never its arguments or data. */
export interface ActionCall {
  name: string;
  ok: boolean;
  statusCode: number | null;
}

/** Mutable per-turn record the guardrails read after the tool loop (docs/actions.md). */
export interface ActionToolState {
  executed: number;
  /** `data` of this turn's results as JSON text: figures in them are trusted. */
  results: string[];
  /** Values the customer agreed to read back in a confirmation question: vouch for figures. */
  readback: string[];
  /** A confirmation question was stored this turn: it must reach the customer or be dropped. */
  askedConfirmation: boolean;
  calls: ActionCall[];
  /** Set to a guardrail name when the turn must end in the fallback; undefined = not decided. */
  fallback: string | null | undefined;
}

export const newActionToolState = (): ActionToolState => ({
  executed: 0,
  results: [],
  readback: [],
  askedConfirmation: false,
  calls: [],
  fallback: undefined,
});

export const CONFIRM_TOOL = 'confirm_pending_action';
export const CANCEL_TOOL = 'cancel_pending_action';

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
export function vouchedValues(args: ActionArgs, texts: readonly string[]): string[] {
  return Object.values(args)
    .map(String)
    .filter((value) =>
      texts.some((t) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, 'iu').test(t),
      ),
    );
}

/** A stable UUID for the playground, which has no conversation: lets confirmations work in tests. */
export function playgroundConversationId(botId: string): string {
  const h = createHash('sha1').update(`playground:${botId}`).digest('hex');
  const variant = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** JSON for the model that cannot close a tag early. */
export function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replaceAll('<', '\\u003c');
}

const inputSchema = (action: BotActionView): z.ZodObject => {
  const shape: Record<string, z.ZodType> = {};
  for (const p of action.params) {
    const base = p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.string();
    shape[p.name] = p.required ? base : base.optional();
  }
  return z.object(shape);
};

/**
 * Tools of the owner's actions: `action_1..action_n` in the order of `actions` (the name→action map
 * stays server-side), plus confirm/cancel only while a call is pending. The model never sees a URL.
 */
export function actionTools(
  actions: readonly BotActionView[],
  pending: PendingAction | null,
): { definitions: ToolDefinition[]; byName: Map<string, BotActionView> } {
  const byName = new Map<string, BotActionView>();
  const definitions: ToolDefinition[] = actions.map((action, i) => {
    const name = `action_${i + 1}`;
    byName.set(name, action);
    return {
      name,
      description: `${action.name}: ${action.description}${action.requiresConfirm ? ' (asks the customer to confirm first)' : ''}`,
      input: inputSchema(action),
    };
  });
  if (pending) {
    definitions.push(
      {
        name: CONFIRM_TOOL,
        description:
          'The customer agreed to the pending action: runs it with the stored arguments.',
        input: z.object({}),
      },
      {
        name: CANCEL_TOOL,
        description: 'The customer declined or changed their mind: drops the pending action.',
        input: z.object({}),
      },
    );
  }
  return { definitions, byName };
}

export interface ActionToolContext {
  facade: ActionFacade;
  ws: WorkspaceId;
  botId: string;
  /** A UUID: the real conversation, or a stable per-bot id in the playground. */
  conversationId: string;
  isTest: boolean;
  /** What the customer wrote this turn: the only text (besides trusted results) that vouches for an argument. */
  customerTexts: readonly string[];
  byName: Map<string, BotActionView>;
  /** Idempotency key of a call: stable for the same logical write (see `idempotencyKey`). */
  keyFor(actionId: string, args: ActionArgs): string;
  state: ActionToolState;
}

export interface ActionToolResult {
  content: string;
  trusted: string;
}

const result = (value: unknown, trusted = ''): ActionToolResult => ({
  content: safeJson(value),
  trusted,
});

const isInvalidJson = (input: unknown): boolean =>
  typeof input === 'object' && input !== null && '__invalidJson' in input;

/**
 * Runs one action tool call (docs/actions.md): at most `MAX_ACTION_ROUNDS` executions per customer
 * turn; a call that needs confirmation is only stored (the customer is asked) and runs, with the
 * STORED arguments, when the customer agrees. The model names a tool, the server does the rest.
 */
export async function runActionTool(
  ctx: ActionToolContext,
  call: ToolCall,
): Promise<ActionToolResult> {
  const { facade, ws, botId, conversationId, state } = ctx;

  if (call.name === CANCEL_TOOL) {
    await facade.clearPending(ws, conversationId);
    return result({ status: 'cancelled' });
  }

  let action: BotActionView | undefined;
  let pending: PendingAction | null = null;
  let args: ActionArgs;

  if (call.name === CONFIRM_TOOL) {
    // Never the model's arguments: only what was stored when the customer was asked.
    if (state.executed >= MAX_ACTION_ROUNDS) return limit(state);
    // Atomic take BEFORE the call: of two concurrent confirmations only one gets the stored write.
    pending = await facade.consumePending(ws, conversationId);
    if (!pending) return result({ error: 'nothing_pending' });
    const actionId = pending.actionId;
    action = [...ctx.byName.values()].find((a) => a.id === actionId);
    if (!action) return result({ error: 'unknown_action' });
    args = pending.args;
  } else {
    action = ctx.byName.get(call.name);
    if (!action) return result({ error: 'unknown_tool' });
    if (isInvalidJson(call.input)) return result({ error: 'invalid_arguments' });
    const parsed = inputSchema(action).safeParse(call.input);
    if (!parsed.success) return result({ error: 'invalid_arguments' });
    args = parsed.data as ActionArgs;
    if (action.requiresConfirm) {
      await facade.setPending(ws, conversationId, { actionId: action.id, args });
      state.askedConfirmation = true;
      state.readback = vouchedValues(args, [...ctx.customerTexts, ...state.results]);
      return result({ status: 'awaiting_customer_confirmation', readBack: args });
    }
  }

  if (state.executed >= MAX_ACTION_ROUNDS) return limit(state);
  state.executed += 1;
  const outcome = await facade.invoke(ws, botId, {
    actionId: action.id,
    args,
    conversationId,
    idempotencyKey: ctx.keyFor(action.id, args),
    isTest: ctx.isTest,
  });
  // The write may not have happened: let the customer say "ok" again instead of losing the call.
  if (pending && !outcome.ok && TRANSIENT_ERRORS.has(outcome.errorCode)) {
    await facade.setPending(ws, conversationId, { actionId: pending.actionId, args });
  }
  state.calls.push({ name: action.name, ok: outcome.ok, statusCode: outcome.statusCode ?? null });
  if (!outcome.ok) return result({ ok: false, errorCode: outcome.errorCode });
  const data = safeJson(outcome.data);
  state.results.push(data);
  return result({ ok: true, statusCode: outcome.statusCode, data: outcome.data }, data);
}

function limit(state: ActionToolState): ActionToolResult {
  state.fallback = 'action_loop_limit';
  return result({ error: 'limit' });
}
