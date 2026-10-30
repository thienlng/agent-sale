import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ActionFacade, ActionOutcome, BotActionView } from '../../action/api/index.js';
import { runActionLoop, type ActionLoopInput, type ModelTurn } from '../application/action-loop.js';
import type { BuiltinInvoker } from '../application/builtin-tools.js';
import { parseModelReply } from '../domain/model-reply.js';

const ws = workspaceId(newId());
const turn = (value: object): ModelTurn => {
  const text = JSON.stringify(value);
  return { text, output: parseModelReply(text) };
};
const callTurn = (actionId: string) =>
  turn({ outcome: 'call_action', reply: '', sources: [], actionId, args: { kind: 'demo' } });
const answerTurn = turn({ outcome: 'answer', reply: 'Dạ vâng ạ.', sources: [] });
const view = (id: string, name: string): BotActionView =>
  ({ id, name, method: 'POST', requiresConfirm: false, params: [] }) as unknown as BotActionView;

const BUILTIN = view('builtin.saas.request', 'Record a request');
const DECLARED = view(newId(), 'Check stock');

function input(over: Partial<ActionLoopInput> & Pick<ActionLoopInput, 'first'>): ActionLoopInput {
  const turns = [answerTurn];
  return {
    facade: null,
    ws,
    botId: newId(),
    conversationId: newId(),
    isTest: false,
    actions: [BUILTIN, DECLARED],
    reminder: 'json',
    customerTexts: [],
    keyFor: () => 'key',
    ask: vi.fn(async () => turns.shift() ?? answerTurn),
    ...over,
  };
}

const ok: ActionOutcome = { ok: true, statusCode: 200, data: { recorded: true } };

describe('runActionLoop with built-in tools', () => {
  it('runs a built-in tool without the action module', async () => {
    const builtin = vi.fn<BuiltinInvoker>(async () => ok);
    const res = await runActionLoop(
      input({ first: callTurn(BUILTIN.id), builtins: new Map([[BUILTIN.id, builtin]]) }),
    );
    expect(builtin).toHaveBeenCalledWith({ kind: 'demo' });
    expect(res).toMatchObject({
      kind: 'turn',
      calls: [{ name: 'Record a request', ok: true, statusCode: 200 }],
    });
  });

  it('falls back on a declared action when the action module is absent', async () => {
    const res = await runActionLoop(
      input({ first: callTurn(DECLARED.id), builtins: new Map([[BUILTIN.id, async () => ok]]) }),
    );
    expect(res).toEqual({ kind: 'fallback', guardrail: null, calls: [] });
  });

  it('routes built-in ids in-process and declared ids to the action module in one turn', async () => {
    const invoke = vi.fn(async () => ({ ok: true, statusCode: 201, data: { stock: 3 } }));
    const facade = { invoke } as unknown as ActionFacade;
    const builtin = vi.fn<BuiltinInvoker>(async () => ok);
    const ask = vi
      .fn<ActionLoopInput['ask']>()
      .mockResolvedValueOnce(callTurn(DECLARED.id))
      .mockResolvedValueOnce(answerTurn);
    const res = await runActionLoop(
      input({
        facade,
        first: callTurn(BUILTIN.id),
        builtins: new Map([[BUILTIN.id, builtin]]),
        ask,
      }),
    );
    expect(builtin).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]).toEqual([
      ws,
      expect.any(String),
      expect.objectContaining({ actionId: DECLARED.id }),
    ]);
    expect(res).toMatchObject({
      kind: 'turn',
      calls: [
        { name: 'Record a request', ok: true },
        { name: 'Check stock', ok: true, statusCode: 201 },
      ],
    });
  });

  it('hands a failed built-in call back to the model as an error code', async () => {
    const ask = vi.fn<ActionLoopInput['ask']>(async () => answerTurn);
    const res = await runActionLoop(
      input({
        first: callTurn(BUILTIN.id),
        builtins: new Map([[BUILTIN.id, async () => ({ ok: false, errorCode: 'network' })]]),
        ask,
      }),
    );
    expect(res).toMatchObject({ kind: 'turn', calls: [{ ok: false, statusCode: null }] });
    expect(ask.mock.calls[0]?.[0].at(-1)?.content).toContain('"errorCode":"network"');
  });
});
