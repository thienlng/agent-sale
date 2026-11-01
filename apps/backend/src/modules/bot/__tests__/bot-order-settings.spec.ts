import { newId, userId, workspaceId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { BotService } from '../application/bot.service.js';
import { BotModule } from '../bot.module.js';
import { Bot } from '../domain/bot.js';
import { botRow, toBot } from '../infrastructure/bot.persistence.js';

async function setup(industry: 'retail' | 'hotel' = 'retail') {
  const moduleRef = await Test.createTestingModule({ imports: [BotModule] }).compile();
  const workspace = await moduleRef.get<WorkspaceFacade>(WORKSPACE_FACADE).createWorkspace({
    name: 'Toy shop',
    industry,
    ownerUserId: userId(newId()),
  });
  return { ws: workspaceId(workspace.id), bots: moduleRef.get(BotService) };
}

describe('Bot order settings ("Chốt đơn")', () => {
  it('round-trips order taking and the shipping fee through the API and the bot view', async () => {
    const { ws, bots } = await setup();
    const bot = await bots.create(ws, { name: 'Shop', industry: 'retail' });
    await bots.update(ws, bot.id, { settings: { orderTaking: true, orderShippingFeeVnd: 30000 } });
    expect((await bots.get(ws, bot.id)).settings).toMatchObject({
      orderTaking: true,
      orderShippingFeeVnd: 30000,
    });
    expect(await bots.getBot(ws, bot.id)).toMatchObject({
      orderTaking: true,
      orderShippingFeeVnd: 30000,
    });

    // A partial update keeps them; null means the shop tells the fee later.
    await bots.update(ws, bot.id, { settings: { mission: 'Bán đồ chơi gỗ cho bé' } });
    await bots.update(ws, bot.id, { settings: { orderShippingFeeVnd: null } });
    expect((await bots.get(ws, bot.id)).settings).toMatchObject({
      orderTaking: true,
      orderShippingFeeVnd: null,
    });
  });

  it('starts on for a new shop bot and off for a hotel bot', async () => {
    const shop = await setup();
    const a = await shop.bots.create(shop.ws, { name: 'A', industry: 'retail' });
    expect(a.settings.orderTaking).toBe(true);
    const hotel = await setup('hotel');
    const b = await hotel.bots.create(hotel.ws, { name: 'B', industry: 'hotel' });
    expect(b.settings.orderTaking).toBe(false);
  });

  it('stores them in their own columns, not in the settings document', () => {
    const bot = Bot.create({ workspaceId: workspaceId(newId()), name: 'Shop', industry: 'retail' });
    bot.updateSettings({ orderTaking: true, orderShippingFeeVnd: 25000 });
    const row = botRow(bot);
    expect(row).toMatchObject({ orderTaking: true, orderShippingFeeVnd: 25000 });
    expect(row.settings).not.toHaveProperty('orderTaking');
    expect(row.settings).not.toHaveProperty('orderShippingFeeVnd');

    const back = toBot({ ...row, deletedAt: null }).snapshot().settings;
    expect(back).toMatchObject({ orderTaking: true, orderShippingFeeVnd: 25000 });
  });

  it('reads an existing bot (column defaults) as off with no shipping fee', () => {
    const bot = Bot.create({ workspaceId: workspaceId(newId()), name: 'Old', industry: 'retail' });
    const row = { ...botRow(bot), orderTaking: false, orderShippingFeeVnd: null, deletedAt: null };
    expect(toBot(row).snapshot().settings).toMatchObject({
      orderTaking: false,
      orderShippingFeeVnd: null,
    });
  });
});
