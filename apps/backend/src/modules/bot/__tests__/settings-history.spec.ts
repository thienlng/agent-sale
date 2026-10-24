import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { Test } from '@nestjs/testing';

import { TRAINING_FACADE, type TrainingFacade } from '../../knowledge/api/index.js';
import { BotService } from '../application/bot.service.js';
import { BotModule } from '../bot.module.js';

const ws = workspaceId(newId());

/** The real module wiring (in-memory stores without a database). */
async function setup() {
  const moduleRef = await Test.createTestingModule({ imports: [BotModule] }).compile();
  return {
    training: moduleRef.get<TrainingFacade>(TRAINING_FACADE),
    bots: moduleRef.get(BotService),
  };
}

describe('Bot settings history', () => {
  it('records who changed which fields and restores the previous values', async () => {
    const { training, bots } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    await bots.update(ws, bot.id, { isActive: true, settings: { modelTier: 'pro' } }, 'Ken');
    // An update that changes nothing is not recorded.
    await bots.update(ws, bot.id, { settings: { modelTier: 'pro' } }, 'Ken');
    const [entry, ...rest] = await training.history(ws, bot.id);
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
    const { training, bots } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    await bots.update(ws, bot.id, { settings: { placeholders: { 'store.name': 'Giày Ken' } } });
    const [entry] = await training.history(ws, bot.id);
    await bots.restoreHistory(ws, bot.id, entry!.id);
    expect((await bots.get(ws, bot.id)).settings.placeholders).toEqual({});
  });
});
