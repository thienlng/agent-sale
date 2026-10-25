import type { ActionInput } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import { ActionModule } from '../action.module.js';
import { ACTION_FACADE } from '../api/index.js';
import { ActionFacadeImpl } from '../application/action.facade.impl.js';
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
    { statusCode: 200, fields: [{ name: 'status', type: 'string', description: 'Status' }] },
  ],
  auth: { kind: 'api_key', headerName: 'X-Api-Key' },
  authSecret: 'super-secret-key',
  requiresConfirm: false,
  enabled: true,
  ...over,
});

function setup() {
  const uow = new InMemoryActionUnitOfWork();
  return { facade: new ActionFacadeImpl(uow, box), uow };
}

describe('ActionFacade (contract)', () => {
  it('is provided by the module', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ActionModule] }).compile();
    expect(moduleRef.get(ACTION_FACADE)).toBeDefined();
  });
});

describe('ActionFacade CRUD', () => {
  it('never exposes the secret in a DTO and seals it at rest', async () => {
    const { facade, uow } = setup();
    const dto = await facade.create(ws, botId, input());
    expect(dto.hasSecret).toBe(true);
    expect(JSON.stringify(await facade.list(ws, botId))).not.toContain('super-secret-key');
    expect(JSON.stringify(await facade.get(ws, botId, dto.id))).not.toContain('authSecret');
    const stored = await uow.run(ws, (r) => r.find(botId, dto.id));
    expect(stored?.authSecretEnc).toBeTruthy();
    expect(stored?.authSecretEnc).not.toContain('super-secret-key');
    expect(box.open(stored?.authSecretEnc ?? '')).toBe('super-secret-key');
  });

  it('keeps the secret on update without authSecret, replaces it, and clears it with an empty string', async () => {
    const { facade, uow } = setup();
    const { id } = await facade.create(ws, botId, input());
    const sealed = async () => (await uow.run(ws, (r) => r.find(botId, id)))?.authSecretEnc;
    const before = await sealed();
    const renamed = await facade.update(ws, botId, id, { name: 'Renamed' });
    expect(renamed).toMatchObject({ name: 'Renamed', hasSecret: true });
    expect(await sealed()).toBe(before);
    await facade.update(ws, botId, id, { authSecret: 'second-key' });
    expect(box.open((await sealed()) ?? '')).toBe('second-key');
    expect((await facade.update(ws, botId, id, { authSecret: '' })).hasSecret).toBe(false);
    expect(await sealed()).toBeNull();
  });

  it('drops the secret when auth becomes none and stores none without a secret', async () => {
    const { facade } = setup();
    const { id } = await facade.create(ws, botId, input());
    expect((await facade.update(ws, botId, id, { auth: { kind: 'none' } })).hasSecret).toBe(false);
    const open = await facade.create(ws, botId, input({ auth: { kind: 'none' } }));
    expect(open.hasSecret).toBe(false);
  });

  it('validates the merged result of a patch', async () => {
    const { facade } = setup();
    const { id } = await facade.create(ws, botId, input());
    await expect(
      facade.update(ws, botId, id, { url: 'https://shop.example.com/{missing}' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      facade.update(ws, botId, id, { url: 'http://shop.example.com/x/{code}' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('lists per bot and removes', async () => {
    const { facade } = setup();
    const a = await facade.create(ws, botId, input());
    await facade.create(ws, newId(), input());
    expect((await facade.list(ws, botId)).map((x) => x.id)).toEqual([a.id]);
    await facade.remove(ws, botId, a.id);
    expect(await facade.list(ws, botId)).toEqual([]);
    await expect(facade.remove(ws, botId, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers not found across bots, workspaces and malformed ids', async () => {
    const { facade } = setup();
    const { id } = await facade.create(ws, botId, input());
    await expect(facade.get(ws, newId(), id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(facade.get(workspaceId(newId()), botId, id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(facade.get(ws, botId, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(facade.update(ws, botId, 'nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists only enabled actions for the prompt, without url or secret', async () => {
    const { facade } = setup();
    const on = await facade.create(ws, botId, input());
    await facade.create(ws, botId, input({ name: 'Off', enabled: false }));
    const view = await facade.listForBot(ws, botId);
    expect(view.map((v) => v.id)).toEqual([on.id]);
    expect(JSON.stringify(view)).not.toContain('shop.example.com');
    expect(JSON.stringify(view)).not.toContain('super-secret-key');
    expect(view[0]?.responseFields).toEqual([
      { name: 'status', type: 'string', description: 'Status' },
    ]);
  });

  it('test() reports a network failure until the executor is wired, and 404s unknown actions', async () => {
    const { facade } = setup();
    const { id } = await facade.create(ws, botId, input());
    expect(await facade.test(ws, botId, id, { code: 'A1' })).toMatchObject({
      ok: false,
      errorCode: 'network',
      statusCode: null,
    });
    await expect(facade.test(ws, botId, newId(), {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ActionFacade pending confirmation', () => {
  const conv = newId();

  async function withPending() {
    const { facade } = setup();
    const action = await facade.create(ws, botId, input());
    await facade.setPending(ws, conv, { actionId: action.id, args: { code: 'A1' } });
    return { facade, action };
  }

  it('consumes the pending call exactly once', async () => {
    const { facade, action } = await withPending();
    expect(await facade.consumePending(ws, conv)).toMatchObject({
      actionId: action.id,
      args: { code: 'A1' },
    });
    expect(await facade.consumePending(ws, conv)).toBeNull();
    expect(await facade.getPending(ws, conv)).toBeNull();
  });

  it('hands the pending call to only one of two concurrent consumers', async () => {
    const { facade } = await withPending();
    const results = await Promise.all([
      facade.consumePending(ws, conv),
      facade.consumePending(ws, conv),
      facade.consumePending(ws, conv),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('does not consume an expired pending call and tells when it was asked', async () => {
    const { facade } = await withPending();
    const asked = (await facade.getPending(ws, conv))?.askedAt;
    expect(Date.now() - (asked?.getTime() ?? 0)).toBeLessThan(5_000);
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000, toFake: ['Date'] });
    try {
      expect(await facade.consumePending(ws, conv)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
