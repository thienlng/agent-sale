import {
  CreateWebsiteRequest,
  type ProductDto,
  type UpsertProductRequest,
} from '@agent-sales/contracts';
import { type UserId, type WorkspaceId, workspaceId } from '@agent-sales/shared';

import type { BotSetupFacade } from '../../modules/bot/api/index.js';
import type { ChannelFacade } from '../../modules/channel/api/index.js';
import type { WorkspaceFacade } from '../../modules/workspace/api/index.js';
import {
  SITE_BOT_NAME,
  SITE_CHANNEL_NAME,
  SITE_FAQS,
  SITE_GREETING,
  SITE_MISSION,
  SITE_PLAN_BOT_NOTES,
  SITE_PLANS,
  type SitePlan,
  SITE_PROFILE_FIELDS,
  SITE_PROFILE_NOTES,
  SITE_AVATAR_PATH,
  SITE_WIDGET,
} from './content.js';

/** The Rapiz HQ business, as `hq-init` creates it (ADR-021). */
export const HQ_NAME = 'Rapiz';
/** Who changed the bot, in its training history. */
export const SEED_ACTOR = 'rapiz-site-bot';

export interface SiteBotDeps {
  workspaces: Pick<WorkspaceFacade, 'listMemberships' | 'createWorkspace'>;
  bots: BotSetupFacade;
  channels: Pick<ChannelFacade, 'createWebsite' | 'updateWebsite'>;
  /** Id of a live website connection bound to the bot, or null (the channel facade lists none). */
  findWebsite(ws: WorkspaceId, botId: string): Promise<string | null>;
  plans: {
    /** The live product with this code, or null. */
    find(ws: WorkspaceId, code: string): Promise<ProductDto | null>;
    create(ws: WorkspaceId, body: UpsertProductRequest): Promise<ProductDto>;
    update(ws: WorkspaceId, id: string, body: UpsertProductRequest): Promise<ProductDto>;
    /** Copies a site picture (`/images/…`) into the business's product pictures; null on failure. */
    picture(ws: WorkspaceId, sitePath: string): Promise<string | null>;
  };
}

export interface SiteBotResult {
  workspaceId: WorkspaceId;
  botId: string;
  connectionId: string;
  siteKey: string;
  created: { workspace: boolean; bot: boolean; website: boolean };
  faqs: { created: number; updated: number; unchanged: number };
  plans: { created: number; updated: number; withoutPicture: string[] };
}

const sameQuestion = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('vi') === b.trim().toLocaleLowerCase('vi');

/**
 * Idempotent: finds or creates the owner's SaaS business "Rapiz", its bot "Rapiz" and a website
 * connection bound to that bot, then writes the version-controlled content (`content.ts`) over
 * them. FAQs are matched by question, so FAQs added by hand stay.
 */
export async function seedRapizSiteBot(
  deps: SiteBotDeps,
  input: { ownerUserId: UserId; domains: readonly string[] },
): Promise<SiteBotResult> {
  const domains = CreateWebsiteRequest.shape.domains.parse([...new Set(input.domains)]);

  const existingWs = (await deps.workspaces.listMemberships(input.ownerUserId)).find(
    (m) => m.role === 'owner' && m.industry === 'saas' && m.workspaceName === HQ_NAME,
  );
  const ws =
    existingWs?.workspaceId ??
    workspaceId(
      (
        await deps.workspaces.createWorkspace({
          name: HQ_NAME,
          industry: 'saas',
          ownerUserId: input.ownerUserId,
        })
      ).id,
    );

  const existingBot = (await deps.bots.list(ws)).find((b) => b.name === SITE_BOT_NAME);
  const botId =
    existingBot?.id ?? (await deps.bots.create(ws, { name: SITE_BOT_NAME, industry: 'saas' })).id;
  await deps.bots.update(
    ws,
    botId,
    {
      isActive: true,
      settings: {
        mission: SITE_MISSION,
        greeting: SITE_GREETING,
        language: 'vi',
        orderTaking: false,
        profile: { fields: { ...SITE_PROFILE_FIELDS }, notes: SITE_PROFILE_NOTES },
      },
    },
    SEED_ACTOR,
  );

  const faqs = { created: 0, updated: 0, unchanged: 0 };
  const current = await deps.bots.listFaqs(ws, botId);
  for (const faq of SITE_FAQS) {
    const found = current.find((f) => sameQuestion(f.question, faq.question));
    if (!found) {
      await deps.bots.createFaq(ws, botId, faq, SEED_ACTOR);
      faqs.created++;
    } else if (found.answer.trim() !== faq.answer) {
      await deps.bots.updateFaq(ws, botId, found.id, { answer: faq.answer }, SEED_ACTOR);
      faqs.updated++;
    } else faqs.unchanged++;
  }

  const plans = await seedPlans(deps, ws, botId);

  const existingSite = await deps.findWebsite(ws, botId);
  const connectionId =
    existingSite ??
    (await deps.channels.createWebsite(ws, { name: SITE_CHANNEL_NAME, domains, botId })).id;
  // The bubble shows the bot avatar: the faceted R the site publishes, on its first public domain.
  const publicDomain = domains.find((d) => d.includes('.') && !/^[\d.]+$/.test(d));
  const site = await deps.channels.updateWebsite(ws, connectionId, {
    enabled: true,
    domains,
    ...SITE_WIDGET,
    ...(publicDomain ? { avatarUrl: `https://${publicDomain}${SITE_AVATAR_PATH}` } : {}),
  });

  return {
    workspaceId: ws,
    botId,
    connectionId,
    siteKey: site.externalId,
    created: { workspace: !existingWs, bot: !existingBot, website: !existingSite },
    faqs,
    plans,
  };
}

/**
 * The plans as products of the bot, matched by code. Variants keep their ids by SKU, so a re-seed
 * changes prices in place; a product's pictures are only copied while it has none.
 */
async function seedPlans(
  deps: SiteBotDeps,
  ws: WorkspaceId,
  botId: string,
): Promise<SiteBotResult['plans']> {
  const result: SiteBotResult['plans'] = { created: 0, updated: 0, withoutPicture: [] };
  for (const plan of SITE_PLANS) {
    const found = await deps.plans.find(ws, plan.code);
    let imageUrls = found?.imageUrls ?? [];
    if (!imageUrls.length) {
      const url = await deps.plans.picture(ws, plan.image);
      if (url) imageUrls = [url];
      else result.withoutPicture.push(plan.name);
    }
    const body = planBody(plan, imageUrls, found);
    if (found) {
      await deps.plans.update(ws, found.id, body);
      result.updated++;
    } else {
      await deps.plans.create(ws, { ...body, botId });
      result.created++;
    }
  }
  return result;
}

function planBody(
  plan: SitePlan,
  imageUrls: string[],
  found: ProductDto | null,
): UpsertProductRequest {
  const idOf = (sku: string) => found?.variants.find((v) => v.sku === sku)?.id;
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    category: 'Gói Rapiz',
    visibleToBot: true,
    botInstructions: SITE_PLAN_BOT_NOTES,
    imageUrls,
    offering: { kind: 'service', priceNote: plan.priceNote },
    status: 'active',
    variants: plan.variants.map((v) => {
      const id = idOf(v.sku);
      return { ...(id ? { id } : {}), sku: v.sku, name: v.name, price: v.price };
    }),
  };
}
