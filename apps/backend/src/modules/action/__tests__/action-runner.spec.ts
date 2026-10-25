import type { ActionInput } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import { ActionFacadeImpl, PENDING_TTL_MS } from '../application/action.facade.impl.js';
import type { SafeHttp } from '../application/action-runner.js';
import { InMemoryActionUnitOfWork } from '../infrastructure/persistence/action.in-memory-repository.js';

const box = SecretBox.insecureDevelopmentBox();
const ws = workspaceId(newId());
const botId = newId();

const input = (over: Partial<ActionInput> = {}): ActionInput => ({
  name: 'Order lookup',
  description: 'Look up an order by code.',
  url: 'https://shop.example.com/api/orders/{code}',
  method: 'GET',
  params: [
    { name: 'code', type: 'string', location: 'path', required: true, description: 'Order code' },
  ],
  responses: [
    {
      statusCode: 200,
      fields: [
        { name: 'status', type: 'string', description: 'Status' },
        { name: 'total', type: 'number', description: 'Total' },
      ],
    },
  ],
  auth: { kind: 'bearer' },
  authSecret: 'tok-123',
  requiresConfirm: false,
  enabled: true,
  ...over,
});

function setup(http: SafeHttp = async () => ({ ok: true, status: 200, json: { status: 'paid' } })) {
  const safeHttp = vi.fn(http);
  const uow = new InMemoryActionUnitOfWork();
  return { facade: new ActionFacadeImpl(uow, box, safeHttp), safeHttp, uow };
}
const call = (actionId: string, args = {}, over = {}) => ({
  actionId,
  args,
  conversationId: newId(),
  idempotencyKey: 'idem-1',
  isTest: false,
  ...over,
});

describe('invoke', () => {
  it('calls the API with the decrypted secret and trims the response', async () => {
    const { facade, safeHttp, uow } = setup(async () => ({
      ok: true,
      status: 200,
      json: { status: 'paid', total: 9, internalNote: 'private' },
    }));
    const a = await facade.create(ws, botId, input());
    const out = await facade.invoke(ws, botId, call(a.id, { code: 'A1', extra: 'x' }));
    expect(out).toEqual({ ok: true, statusCode: 200, data: { status: 'paid', total: 9 } });
    const req = safeHttp.mock.calls[0]?.[0];
    expect(req?.url).toBe('https://shop.example.com/api/orders/A1');
    expect(req?.headers['Authorization']).toBe('Bearer tok-123');
    expect(req?.headers['Idempotency-Key']).toBeUndefined();
    const runs = uow.runs.get(ws) ?? [];
    expect(runs).toHaveLength(1);
    expect(JSON.stringify(runs)).not.toMatch(/A1|paid|tok-123/);
    expect(runs[0]).toMatchObject({ ok: true, statusCode: 200, isTest: false, errorCode: null });
  });

  it('sends the given Idempotency-Key on writes', async () => {
    const { facade, safeHttp } = setup();
    const a = await facade.create(
      ws,
      botId,
      input({
        method: 'POST',
        url: 'https://shop.example.com/book',
        params: [{ name: 'n', type: 'string', location: 'body', required: true, description: 'd' }],
      }),
    );
    await facade.invoke(ws, botId, call(a.id, { n: 'An' }, { idempotencyKey: 'bot:evt:act' }));
    expect(safeHttp.mock.calls[0]?.[0].headers['Idempotency-Key']).toBe('bot:evt:act');
  });

  it('returns invalid_args without calling the network', async () => {
    const { facade, safeHttp } = setup();
    const a = await facade.create(ws, botId, input());
    expect(await facade.invoke(ws, botId, call(a.id, {}))).toEqual({
      ok: false,
      errorCode: 'invalid_args',
    });
    expect(safeHttp).not.toHaveBeenCalled();
  });

  it('maps an undeclared status to bad_status', async () => {
    const { facade } = setup(async () => ({ ok: true, status: 201, json: { status: 'x' } }));
    const a = await facade.create(ws, botId, input());
    expect(await facade.invoke(ws, botId, call(a.id, { code: 'A' }))).toEqual({
      ok: false,
      errorCode: 'bad_status',
      statusCode: 201,
    });
  });

  it('passes safe-http error categories through and records them', async () => {
    for (const errorCode of ['timeout', 'blocked_host', 'too_large', 'network'] as const) {
      const { facade, uow } = setup(async () => ({ ok: false, errorCode }));
      const a = await facade.create(ws, botId, input());
      expect(await facade.invoke(ws, botId, call(a.id, { code: 'A' }))).toEqual({
        ok: false,
        errorCode,
      });
      expect(uow.runs.get(ws)?.[0]).toMatchObject({ ok: false, errorCode });
    }
  });

  it('turns a thrown transport into network', async () => {
    const { facade } = setup(async () => {
      throw new Error('boom https://secret.example.com');
    });
    const a = await facade.create(ws, botId, input());
    expect(await facade.invoke(ws, botId, call(a.id, { code: 'A' }))).toEqual({
      ok: false,
      errorCode: 'network',
    });
  });

  it('refuses disabled, unknown and other bots actions', async () => {
    const { facade, safeHttp } = setup();
    const off = await facade.create(ws, botId, input({ enabled: false }));
    const on = await facade.create(ws, botId, input());
    expect(await facade.invoke(ws, botId, call(off.id, { code: 'A' }))).toEqual({
      ok: false,
      errorCode: 'disabled',
    });
    expect(await facade.invoke(ws, newId(), call(on.id, { code: 'A' }))).toEqual({
      ok: false,
      errorCode: 'not_found',
    });
    expect(await facade.invoke(ws, botId, call(newId(), { code: 'A' }))).toEqual({
      ok: false,
      errorCode: 'not_found',
    });
    expect(await facade.invoke(ws, botId, call('nope'))).toEqual({
      ok: false,
      errorCode: 'not_found',
    });
    expect(safeHttp).not.toHaveBeenCalled();
  });
});

describe('test', () => {
  it('records an is_test run and reports the result', async () => {
    const { facade, uow } = setup();
    const a = await facade.create(ws, botId, input());
    const res = await facade.test(ws, botId, a.id, { code: 'A1' });
    expect(res).toMatchObject({
      ok: true,
      statusCode: 200,
      data: { status: 'paid' },
      errorCode: null,
    });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(uow.runs.get(ws)?.[0]?.isTest).toBe(true);
  });

  it('reports failures and still works on a disabled action', async () => {
    const { facade } = setup(async () => ({ ok: false, errorCode: 'timeout' }));
    const a = await facade.create(ws, botId, input({ enabled: false }));
    expect(await facade.test(ws, botId, a.id, { code: 'A' })).toMatchObject({
      ok: false,
      statusCode: null,
      data: null,
      errorCode: 'timeout',
    });
    await expect(facade.test(ws, botId, newId(), {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('pending confirmation', () => {
  it('stores one per conversation, replaces, expires after the TTL and clears', async () => {
    vi.useFakeTimers();
    try {
      const { facade } = setup();
      const a = await facade.create(ws, botId, input());
      const b = await facade.create(ws, botId, input({ name: 'Other' }));
      const conv = newId();
      expect(await facade.getPending(ws, conv)).toBeNull();
      await facade.setPending(ws, conv, { actionId: a.id, args: { code: '1' } });
      await facade.setPending(ws, conv, { actionId: b.id, args: { code: '2' } });
      const p = await facade.getPending(ws, conv);
      expect(p).toMatchObject({ actionId: b.id, args: { code: '2' } });
      expect(p?.expiresAt.getTime()).toBe(Date.now() + PENDING_TTL_MS);
      vi.advanceTimersByTime(PENDING_TTL_MS - 1);
      expect(await facade.getPending(ws, conv)).not.toBeNull();
      vi.advanceTimersByTime(2);
      expect(await facade.getPending(ws, conv)).toBeNull();
      await facade.setPending(ws, conv, { actionId: a.id, args: {} });
      await facade.clearPending(ws, conv);
      expect(await facade.getPending(ws, conv)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is isolated per workspace and rejects unknown actions', async () => {
    const { facade } = setup();
    const a = await facade.create(ws, botId, input());
    const conv = newId();
    await facade.setPending(ws, conv, { actionId: a.id, args: {} });
    expect(await facade.getPending(workspaceId(newId()), conv)).toBeNull();
    await expect(
      facade.setPending(ws, conv, { actionId: newId(), args: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
