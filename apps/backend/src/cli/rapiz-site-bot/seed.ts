import { CreateWebsiteRequest } from '@agent-sales/contracts';
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
  SITE_PROFILE_FIELDS,
  SITE_PROFILE_NOTES,
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
}

export interface SiteBotResult {
  workspaceId: WorkspaceId;
  botId: string;
  connectionId: string;
  siteKey: string;
  created: { workspace: boolean; bot: boolean; website: boolean };
  faqs: { created: number; updated: number; unchanged: number };
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

  const existingSite = await deps.findWebsite(ws, botId);
  const connectionId =
    existingSite ??
    (await deps.channels.createWebsite(ws, { name: SITE_CHANNEL_NAME, domains, botId })).id;
  const site = await deps.channels.updateWebsite(ws, connectionId, {
    enabled: true,
    domains,
    ...SITE_WIDGET,
  });

  return {
    workspaceId: ws,
    botId,
    connectionId,
    siteKey: site.externalId,
    created: { workspace: !existingWs, bot: !existingBot, website: !existingSite },
    faqs,
  };
}
