/* eslint-disable no-console -- CLI entrypoint */
import 'reflect-metadata';

import { createDb, schema, sql, withSystem } from '@agent-sales/db';
import { userId } from '@agent-sales/shared';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../modules/workspace/api/index.js';
import { WorkspaceModule } from '../modules/workspace/workspace.module.js';

/**
 * `pnpm --filter @agent-sales/backend hq-init <owner-email>` — creates the Rapiz HQ business
 * (ADR-021): workspace "Rapiz", industry `saas`, owned by that existing user, and prints its id for
 * `RAPIZ_HQ_WORKSPACE_ID`. Idempotent: when the user already owns a SaaS business named "Rapiz",
 * prints that one. Needs DATABASE_URL and DATABASE_SYSTEM_URL.
 */
const HQ_NAME = 'Rapiz';
const [email] = process.argv.slice(2);
const env = configureEnv();
if (!email || !env.DATABASE_URL || !env.DATABASE_SYSTEM_URL) {
  console.error('usage: hq-init <owner-email>   (needs DATABASE_URL and DATABASE_SYSTEM_URL)');
  process.exit(1);
}

// Operator tooling, like `workspace-plan`: finding a user by email is not a module use case.
const { db, close } = createDb({ url: env.DATABASE_SYSTEM_URL, max: 1 });
const owner = await withSystem(db, async (tx) => {
  const [u] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`);
  return u?.id ?? null;
}).finally(close);
if (!owner) {
  console.error('no user with this email: sign up first');
  process.exit(1);
}

@Module({ imports: [DbModule, WorkspaceModule] })
class HqInitModule {}

const ctx = await NestFactory.createApplicationContext(HqInitModule, { logger: false });
try {
  const workspaces = ctx.get<WorkspaceFacade>(WORKSPACE_FACADE);
  const existing = (await workspaces.listMemberships(userId(owner))).find(
    (m) => m.role === 'owner' && m.industry === 'saas' && m.workspaceName === HQ_NAME,
  );
  const id =
    existing?.workspaceId ??
    (
      await workspaces.createWorkspace({
        name: HQ_NAME,
        industry: 'saas',
        ownerUserId: userId(owner),
      })
    ).id;
  console.log(existing ? `HQ exists: ${id}` : `HQ created: ${id}`);
  if (env.RAPIZ_HQ_WORKSPACE_ID !== id) console.log(`set RAPIZ_HQ_WORKSPACE_ID=${id}`);
} finally {
  await ctx.close();
}
