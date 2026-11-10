/* eslint-disable no-console -- CLI entrypoint */
import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { and, createDb, eq, schema, sql, withSystem } from '@agent-sales/db';
import { userId } from '@agent-sales/shared';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { BOT_SETUP, type BotSetupFacade } from '../modules/bot/api/index.js';
import { BotModule } from '../modules/bot/bot.module.js';
import { CHANNEL_FACADE, type ChannelFacade } from '../modules/channel/api/index.js';
import { ChannelModule } from '../modules/channel/channel.module.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../modules/workspace/api/index.js';
import { WorkspaceModule } from '../modules/workspace/workspace.module.js';
import { seedRapizSiteBot } from './rapiz-site-bot/seed.js';

/**
 * `pnpm --filter @agent-sales/backend rapiz-site-bot seed --owner <email> [--domains a,b]` — sets
 * up the chat bot of Rapiz's own website (apps/site README "Website chat"): the owner's SaaS
 * business "Rapiz" (the same one `hq-init` finds or creates), its bot "Rapiz" with the content in
 * `rapiz-site-bot/content.ts`, and a website connection bound to it. Idempotent; prints the site
 * key for RAPIZ_SITE_WIDGET_KEY / PUBLIC_RAPIZ_WIDGET_KEY. Needs DATABASE_URL and
 * DATABASE_SYSTEM_URL.
 */
const USAGE =
  'usage: rapiz-site-bot seed --owner <email> [--domains rapiz.vn,www.rapiz.vn,localhost]';
const DEFAULT_DOMAINS = 'rapiz.vn,www.rapiz.vn';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { owner: { type: 'string' }, domains: { type: 'string', default: DEFAULT_DOMAINS } },
});
const env = configureEnv();
const email = values.owner?.trim().toLowerCase();
if (positionals[0] !== 'seed' || !email || !env.DATABASE_URL || !env.DATABASE_SYSTEM_URL) {
  console.error(`${USAGE}   (needs DATABASE_URL and DATABASE_SYSTEM_URL)`);
  process.exit(1);
}
const domains = values.domains
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// Operator tooling, like `hq-init`: finding a user by email and a bot's website connection are not
// module use cases (the channel facade has no listing).
const { db, close } = createDb({ url: env.DATABASE_SYSTEM_URL, max: 1 });
try {
  const owner = await withSystem(db, async (tx) => {
    const [u] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`);
    return u?.id ?? null;
  });
  if (!owner) {
    console.error('no user with this email: sign up first');
    process.exit(1);
  }

  @Module({ imports: [DbModule, WorkspaceModule, BotModule, ChannelModule] })
  class RapizSiteBotModule {}

  const ctx = await NestFactory.createApplicationContext(RapizSiteBotModule, { logger: false });
  try {
    const c = schema.channelConnections;
    const result = await seedRapizSiteBot(
      {
        workspaces: ctx.get<WorkspaceFacade>(WORKSPACE_FACADE),
        bots: ctx.get<BotSetupFacade>(BOT_SETUP),
        channels: ctx.get<ChannelFacade>(CHANNEL_FACADE),
        findWebsite: (ws, botId) =>
          withSystem(db, async (tx) => {
            const [row] = await tx
              .select({ id: c.id })
              .from(c)
              .where(
                and(
                  eq(c.workspaceId, ws),
                  eq(c.provider, 'website'),
                  eq(c.botId, botId),
                  sql`${c.status} <> 'removed'`,
                ),
              )
              .orderBy(c.createdAt)
              .limit(1);
            return row?.id ?? null;
          }),
      },
      { ownerUserId: userId(owner), domains },
    );
    const state = (created: boolean) => (created ? 'created' : 'exists');
    console.log(`business ${state(result.created.workspace)}: ${result.workspaceId}`);
    console.log(`bot ${state(result.created.bot)}: ${result.botId}`);
    console.log(
      `faqs: ${result.faqs.created} created, ${result.faqs.updated} updated, ${result.faqs.unchanged} unchanged`,
    );
    console.log(`website ${state(result.created.website)}: ${result.connectionId}`);
    console.log(`domains: ${domains.join(', ')}`);
    console.log(`site key: ${result.siteKey}`);
  } finally {
    await ctx.close();
  }
} finally {
  await close();
}
