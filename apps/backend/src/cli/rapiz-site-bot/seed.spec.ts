import {
  type BotDto,
  type ChannelConnectionDto,
  type FaqDto,
  type ProductDto,
  PROFILE_FIELDS,
  UpdateBotRequest,
  UpsertProductRequest,
  UpdateWebsiteRequest,
} from '@agent-sales/contracts';
import { userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { SITE_FAQS, SITE_GREETING, SITE_PLANS, SITE_PROFILE_FIELDS } from './content.js';
import { SEED_ACTOR, seedRapizSiteBot, type SiteBotDeps } from './seed.js';

const OWNER = userId('00000000-0000-4000-8000-000000000001');
const WS = workspaceId('00000000-0000-4000-8000-000000000002');
const BOT = '00000000-0000-4000-8000-000000000003';
const SITE = '00000000-0000-4000-8000-000000000004';
const KEY = 'wk_AbCdEfGhIjKlMnOpQrStUv';

const membership = {
  workspaceId: WS,
  workspaceName: 'Rapiz',
  role: 'owner',
  industry: 'saas',
  accountId: null,
  createdAt: new Date(),
};
const bot = { id: BOT, name: 'Rapiz' } as BotDto;
const connection = { id: SITE, externalId: KEY } as ChannelConnectionDto;

const PICTURE =
  '/media/products/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-0000000000aa.png';

function deps(state: {
  workspace?: boolean;
  bot?: boolean;
  site?: boolean;
  faqs?: FaqDto[];
  products?: ProductDto[];
  pictures?: boolean;
}) {
  return {
    workspaces: {
      listMemberships: vi.fn(async () => (state.workspace ? [membership] : [])),
      createWorkspace: vi.fn(async () => ({ id: WS }) as never),
    },
    bots: {
      list: vi.fn(async () => (state.bot ? [bot] : [{ ...bot, id: 'other', name: 'Shop' }])),
      create: vi.fn(async () => bot),
      update: vi.fn(async () => bot),
      listFaqs: vi.fn(async () => state.faqs ?? []),
      createFaq: vi.fn(async () => ({}) as FaqDto),
      updateFaq: vi.fn(async () => ({}) as FaqDto),
    },
    channels: {
      createWebsite: vi.fn(async () => connection),
      updateWebsite: vi.fn(async () => connection),
    },
    findWebsite: vi.fn(async () => (state.site ? SITE : null)),
    plans: {
      find: vi.fn(async (_ws: unknown, code: string) => {
        return state.products?.find((p) => p.code === code) ?? null;
      }),
      create: vi.fn(async () => ({}) as ProductDto),
      update: vi.fn(async () => ({}) as ProductDto),
      picture: vi.fn(async () => (state.pictures === false ? null : PICTURE)),
    },
  } satisfies SiteBotDeps;
}

const DOMAINS = ['rapiz.io', 'LOCALHOST', '127.0.0.1', 'rapiz.io'];

describe('seedRapizSiteBot', () => {
  it('creates the business, bot, FAQs and website on a fresh owner and returns the site key', async () => {
    const d = deps({});
    const result = await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: DOMAINS });

    expect(d.workspaces.createWorkspace).toHaveBeenCalledWith({
      name: 'Rapiz',
      industry: 'saas',
      ownerUserId: OWNER,
    });
    expect(d.bots.create).toHaveBeenCalledWith(WS, { name: 'Rapiz', industry: 'saas' });
    expect(d.bots.createFaq).toHaveBeenCalledTimes(SITE_FAQS.length);
    expect(d.channels.createWebsite).toHaveBeenCalledWith(WS, {
      name: 'Website Rapiz',
      domains: ['rapiz.io', 'localhost', '127.0.0.1'],
      botId: BOT,
    });
    expect(d.channels.updateWebsite).toHaveBeenCalledWith(WS, SITE, {
      enabled: true,
      domains: ['rapiz.io', 'localhost', '127.0.0.1'],
      agentName: 'Rapiz AI',
      phoneChipText: 'Để lại thông tin để được tư vấn chuyên sâu',
      color: '#FF7A45',
      greeting: SITE_GREETING,
      requirePhoneAfter: 0,
      avatarUrl: 'https://rapiz.io/images/rapiz-symbol-faceted.svg',
    });
    expect(result).toEqual({
      workspaceId: WS,
      botId: BOT,
      connectionId: SITE,
      siteKey: KEY,
      created: { workspace: true, bot: true, website: true },
      faqs: { created: SITE_FAQS.length, updated: 0, unchanged: 0 },
      plans: { created: SITE_PLANS.length, updated: 0, withoutPicture: [] },
    });
  });

  it('reuses what exists: updates changed answers only and creates nothing else', async () => {
    const faqs = SITE_FAQS.map(
      (f, i) =>
        ({
          id: `faq-${i}`,
          question: i === 0 ? ` ${f.question.toUpperCase()} ` : f.question,
          answer: i === 1 ? 'old answer' : f.answer,
        }) as FaqDto,
    );
    const d = deps({ workspace: true, bot: true, site: true, faqs });
    const result = await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['rapiz.io'] });

    expect(d.workspaces.createWorkspace).not.toHaveBeenCalled();
    expect(d.bots.create).not.toHaveBeenCalled();
    expect(d.channels.createWebsite).not.toHaveBeenCalled();
    expect(d.bots.createFaq).not.toHaveBeenCalled();
    expect(d.bots.updateFaq).toHaveBeenCalledExactlyOnceWith(
      WS,
      BOT,
      'faq-1',
      { answer: SITE_FAQS[1]!.answer },
      SEED_ACTOR,
    );
    expect(d.findWebsite).toHaveBeenCalledWith(WS, BOT);
    expect(result.created).toEqual({ workspace: false, bot: false, website: false });
    expect(result.faqs).toEqual({ created: 0, updated: 1, unchanged: SITE_FAQS.length - 1 });
  });

  it('activates the bot with a Vietnamese profile the contracts accept', async () => {
    const d = deps({ workspace: true, bot: true, site: true });
    await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['rapiz.io'] });

    const [, botId, change, actor] = d.bots.update.mock.calls[0] as unknown as [
      unknown,
      string,
      UpdateBotRequest,
      string,
    ];
    expect([botId, actor]).toEqual([BOT, SEED_ACTOR]);
    expect(UpdateBotRequest.parse(change)).toEqual(change);
    expect(change).toMatchObject({ isActive: true, settings: { language: 'vi' } });
    expect(change.settings?.mission).toMatch(/Chỉ xin số điện thoại hoặc email khi khách muốn/);
    const saas = PROFILE_FIELDS.filter(
      (f) => f.industries === 'all' || f.industries.includes('saas'),
    );
    for (const [key, value] of Object.entries(SITE_PROFILE_FIELDS)) {
      const field = saas.find((f) => f.key === key);
      expect(field, key).toBeDefined();
      expect(value.length, key).toBeLessThanOrEqual(field!.max);
    }
    const [, , widget] = d.channels.updateWebsite.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
    ];
    expect(UpdateWebsiteRequest.safeParse(widget).success).toBe(true);
  });

  it('puts the plans in the bot catalog with their pictures, as valid product forms', async () => {
    const d = deps({ workspace: true, bot: true, site: true });
    await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['rapiz.io'] });

    expect(d.plans.picture.mock.calls.map((c) => (c as unknown[])[1])).toEqual(
      SITE_PLANS.map((p) => p.image),
    );
    const bodies = d.plans.create.mock.calls.map(
      (c) => (c as unknown[])[1] as UpsertProductRequest,
    );
    expect(bodies.map((b) => [b.code, b.botId, b.imageUrls])).toEqual(
      SITE_PLANS.map((p) => [p.code, BOT, [PICTURE]]),
    );
    for (const b of bodies)
      expect(UpsertProductRequest.safeParse(b).error?.issues, b.code).toBeUndefined();
    expect(bodies[1]).toMatchObject({
      name: 'Sales Smart',
      offering: { kind: 'service', priceNote: '/ tháng' },
      variants: [
        { sku: 'RAPIZ-SALES-SMART-12M', price: 785_000 },
        { sku: 'RAPIZ-SALES-SMART-6M', price: 1_050_000 },
        { sku: 'RAPIZ-SALES-SMART-3M', price: 1_310_000 },
      ],
    });
  });

  it('updates the plans in place: variant ids and pictures stay, missing pictures are reported', async () => {
    const smart = {
      id: 'smart',
      code: 'RAPIZ-SALES-SMART',
      imageUrls: ['/media/products/x/old.png'],
      variants: [{ id: 'v12', sku: 'RAPIZ-SALES-SMART-12M' }],
    } as unknown as ProductDto;
    const d = deps({ workspace: true, bot: true, site: true, products: [smart], pictures: false });
    const result = await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['rapiz.io'] });

    expect(result.plans).toEqual({
      created: SITE_PLANS.length - 1,
      updated: 1,
      withoutPicture: ['Miễn phí', 'Sales Pro', 'Sales Neo'],
    });
    const [, id, body] = d.plans.update.mock.calls[0] as unknown as [
      unknown,
      string,
      UpsertProductRequest,
    ];
    expect(id).toBe('smart');
    expect(body.imageUrls).toEqual(['/media/products/x/old.png']);
    expect(body.variants.map((v) => v.id)).toEqual(['v12', undefined, undefined]);
    expect(body).not.toHaveProperty('botId');
  });

  it('rejects a domain that is not a bare host before writing anything', async () => {
    const d = deps({});
    await expect(
      seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['https://rapiz.io'] }),
    ).rejects.toThrow();
    expect(d.workspaces.createWorkspace).not.toHaveBeenCalled();
  });
});
