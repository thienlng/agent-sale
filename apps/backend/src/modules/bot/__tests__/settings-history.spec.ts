import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { Test } from '@nestjs/testing';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { TRAINING_FACADE, type TrainingFacade } from '../../knowledge/api/index.js';
import { BotService } from '../application/bot.service.js';
import { BotModule } from '../bot.module.js';

/** The real module wiring (in-memory stores without a database). */
async function setup() {
  const moduleRef = await Test.createTestingModule({ imports: [BotModule] }).compile();
  const workspace = await moduleRef.get<WorkspaceFacade>(WORKSPACE_FACADE).createWorkspace({
    name: 'Retail business',
    industry: 'retail',
    ownerUserId: userId(newId()),
  });
  return {
    ws: workspaceId(workspace.id),
    training: moduleRef.get<TrainingFacade>(TRAINING_FACADE),
    bots: moduleRef.get(BotService),
  };
}

describe('Bot creation starter rules', () => {
  it('seeds the starter pack without per-rule history entries', async () => {
    const { training, bots, ws } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    expect((await training.list(ws, bot.id)).length).toBeGreaterThan(0);
    expect(await training.history(ws, bot.id)).toEqual([]);
  });

  it('still creates the bot when seeding the starter rules fails', async () => {
    const { training, bots, ws } = await setup();
    vi.spyOn(training, 'seedStarterRules').mockRejectedValueOnce(new Error('db down'));
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    expect((await bots.get(ws, bot.id)).name).toBe('Shop');
    expect(await training.list(ws, bot.id)).toEqual([]);
  });
});

describe('Bot settings history', () => {
  it('records who changed which fields and restores the previous values', async () => {
    const { training, bots, ws } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    await bots.update(ws, bot.id, { isActive: true, settings: { modelTier: 'pro' } }, 'Ken');
    // An update that changes nothing is not recorded.
    await bots.update(ws, bot.id, { settings: { modelTier: 'pro' } }, 'Ken');
    const settings = (await training.history(ws, bot.id)).filter((e) => e.kind === 'settings');
    const [entry, ...rest] = settings;
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ kind: 'settings', actor: 'Ken', restorable: true });
    expect(entry?.changes).toEqual([
      { field: 'isActive', before: false, after: true },
      { field: 'modelTier', before: 'smart', after: 'pro' },
    ]);

    await bots.restoreHistory(ws, bot.id, entry!.id, 'An');
    const restored = await bots.get(ws, bot.id);
    expect(restored.isActive).toBe(false);
    expect(restored.settings.modelTier).toBe('smart');
    expect((await training.history(ws, bot.id))[0]?.actor).toBe('An');
  });

  it('removes placeholders that the restored change had added', async () => {
    const { training, bots, ws } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    await bots.update(ws, bot.id, { settings: { placeholders: { 'store.name': 'Giày Ken' } } });
    const [entry] = await training.history(ws, bot.id);
    expect(entry?.kind).toBe('settings');
    await bots.restoreHistory(ws, bot.id, entry!.id);
    expect((await bots.get(ws, bot.id)).settings.placeholders).toEqual({});
  });
});
