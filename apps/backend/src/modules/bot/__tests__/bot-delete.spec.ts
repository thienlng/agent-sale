import { newId, userId, workspaceId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { BOT_LIFECYCLE, type BotLifecycle } from '../api/index.js';
import { BotService } from '../application/bot.service.js';
import { BotModule } from '../bot.module.js';

async function setup() {
  const ref = await Test.createTestingModule({ imports: [BotModule] }).compile();
  const workspaces = ref.get<WorkspaceFacade>(WORKSPACE_FACADE);
  const ownerUserId = userId(newId());
  const own = await workspaces.createWorkspace({
    name: 'Retail business',
    industry: 'retail',
    ownerUserId,
  });
  const foreign = await workspaces.createWorkspace({
    name: 'Other business',
    industry: 'retail',
    ownerUserId: userId(newId()),
  });
  return {
    bots: ref.get(BotService),
    lifecycle: ref.get<BotLifecycle>(BOT_LIFECYCLE),
    ws: workspaceId(own.id),
    other: workspaceId(foreign.id),
  };
}

describe('Bot soft delete', () => {
  it('hides the bot from list, get, readiness, FAQs and the facade', async () => {
    const { bots, ws } = await setup();
    const keep = await bots.create(ws, { name: 'Keep', industry: 'retail' });
    const gone = await bots.create(ws, { name: 'Gone', industry: 'retail' });
    await bots.remove(ws, gone.id, { userId: null, name: 'Ken' });
    expect((await bots.list(ws)).map((b) => b.id)).toEqual([keep.id]);
    for (const read of [
      () => bots.get(ws, gone.id),
      () => bots.getBot(ws, gone.id),
      () => bots.readiness(ws, gone.id),
      () => bots.listFaqs(ws, gone.id),
      () => bots.update(ws, gone.id, { name: 'x' }),
      () => bots.remove(ws, gone.id),
    ])
      await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers 404 for a bot of another workspace and leaves it alone', async () => {
    const { bots, ws, other } = await setup();
    const bot = await bots.create(ws, { name: 'Mine', industry: 'retail' });
    await expect(bots.remove(other, bot.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await bots.get(ws, bot.id)).id).toBe(bot.id);
  });

  it('runs the deletion hooks before deleting and keeps the bot when one fails', async () => {
    const { bots, lifecycle, ws } = await setup();
    const bot = await bots.create(ws, { name: 'Hooked', industry: 'retail' });
    const hook = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    lifecycle.onDeleted(hook);
    await expect(bots.remove(ws, bot.id)).rejects.toThrow('boom');
    expect((await bots.get(ws, bot.id)).id).toBe(bot.id);
    await bots.remove(ws, bot.id);
    expect(hook).toHaveBeenLastCalledWith(ws, bot.id);
    await expect(bots.get(ws, bot.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
