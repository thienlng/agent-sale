import { newId, userId, workspaceId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { BOT_FACADE, type BotFacade } from '../api/index.js';
import { BotService } from '../application/bot.service.js';
import { BotModule } from '../bot.module.js';

async function setup() {
  const moduleRef = await Test.createTestingModule({ imports: [BotModule] }).compile();
  const workspace = await moduleRef.get<WorkspaceFacade>(WORKSPACE_FACADE).createWorkspace({
    name: 'Retail business',
    industry: 'retail',
    ownerUserId: userId(newId()),
  });
  return {
    ws: workspaceId(workspace.id),
    bots: moduleRef.get(BotService),
    facade: moduleRef.get<BotFacade>(BOT_FACADE),
  };
}

describe('Bot profile and reply style', () => {
  it('starts with an empty profile and the default style', async () => {
    const { bots, facade, ws } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    expect(bot.settings).toMatchObject({
      profile: { fields: {}, notes: '' },
      replyLength: 'short',
      tone: 'friendly',
      allowEmoji: false,
    });
    expect(await facade.getBot(ws, bot.id)).toMatchObject({
      profile: { fields: {}, notes: '' },
      replyLength: 'short',
      tone: 'friendly',
      allowEmoji: false,
    });
  });

  it('merges profile updates: one field, clearing a key, notes only', async () => {
    const { bots, facade, ws } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    await bots.update(ws, bot.id, {
      settings: {
        profile: { fields: { address: '12 Le Loi', hotline: '0900' }, notes: 'Closed on Tet' },
      },
    });
    await bots.update(ws, bot.id, { settings: { replyLength: 'detailed', allowEmoji: true } });
    let view = await facade.getBot(ws, bot.id);
    expect(view.profile).toEqual({
      fields: { address: '12 Le Loi', hotline: '0900' },
      notes: 'Closed on Tet',
    });
    expect([view.replyLength, view.tone, view.allowEmoji]).toEqual(['detailed', 'friendly', true]);

    await bots.update(ws, bot.id, {
      settings: { profile: { fields: { address: '34 Hai Ba Trung' } } },
    });
    view = await facade.getBot(ws, bot.id);
    expect(view.profile).toEqual({
      fields: { address: '34 Hai Ba Trung', hotline: '0900' },
      notes: 'Closed on Tet',
    });

    await bots.update(ws, bot.id, { settings: { profile: { fields: { hotline: '' } } } });
    view = await facade.getBot(ws, bot.id);
    expect(view.profile.fields).toEqual({ address: '34 Hai Ba Trung' });

    await bots.update(ws, bot.id, { settings: { profile: { notes: 'New notes' } } });
    view = await facade.getBot(ws, bot.id);
    expect(view.profile).toEqual({ fields: { address: '34 Hai Ba Trung' }, notes: 'New notes' });
  });
});
