import {
  type BotDto,
  type ChannelConnectionDto,
  type FaqDto,
  PROFILE_FIELDS,
  UpdateBotRequest,
  UpdateWebsiteRequest,
} from '@agent-sales/contracts';
import { userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { SITE_FAQS, SITE_GREETING, SITE_PROFILE_FIELDS } from './content.js';
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

function deps(state: { workspace?: boolean; bot?: boolean; site?: boolean; faqs?: FaqDto[] }) {
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
  } satisfies SiteBotDeps;
}

const DOMAINS = ['rapiz.vn', 'LOCALHOST', '127.0.0.1', 'rapiz.vn'];

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
      domains: ['rapiz.vn', 'localhost', '127.0.0.1'],
      botId: BOT,
    });
    expect(d.channels.updateWebsite).toHaveBeenCalledWith(WS, SITE, {
      enabled: true,
      domains: ['rapiz.vn', 'localhost', '127.0.0.1'],
      agentName: 'Rapiz',
      color: '#FF7A45',
      greeting: SITE_GREETING,
      requirePhoneAfter: 0,
    });
    expect(result).toEqual({
      workspaceId: WS,
      botId: BOT,
      connectionId: SITE,
      siteKey: KEY,
      created: { workspace: true, bot: true, website: true },
      faqs: { created: SITE_FAQS.length, updated: 0, unchanged: 0 },
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
    const result = await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['rapiz.vn'] });

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
    await seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['rapiz.vn'] });

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

  it('rejects a domain that is not a bare host before writing anything', async () => {
    const d = deps({});
    await expect(
      seedRapizSiteBot(d, { ownerUserId: OWNER, domains: ['https://rapiz.vn'] }),
    ).rejects.toThrow();
    expect(d.workspaces.createWorkspace).not.toHaveBeenCalled();
  });
});
