/* eslint-disable no-console -- CLI entrypoint */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureEnv } from '../common/config.js';
import { DbModule } from '../common/db/db.module.js';
import { SAAS_RUNNER, type SaasRunner } from '../modules/saas/api/index.js';
import { SaasModule } from '../modules/saas/saas.module.js';

/**
 * `pnpm --filter @agent-sales/backend hq-backfill [--dry-run]` — links every platform account to a
 * customer of the Rapiz HQ business (adopted by phone, then email, else created) and writes its
 * subscription; afterwards the live sync and the nightly reconcile keep them current. The same
 * code as the reconcile, so it is safe to run again. `--dry-run` reads and counts, writes nothing.
 * Prints counts only. Needs DATABASE_URL, DATABASE_SYSTEM_URL and RAPIZ_HQ_WORKSPACE_ID.
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const env = configureEnv();
if (
  args.some((a) => a !== '--dry-run') ||
  !env.DATABASE_URL ||
  !env.DATABASE_SYSTEM_URL ||
  !env.RAPIZ_HQ_WORKSPACE_ID
) {
  console.error(
    'usage: hq-backfill [--dry-run]   (needs DATABASE_URL, DATABASE_SYSTEM_URL and RAPIZ_HQ_WORKSPACE_ID)',
  );
  process.exit(1);
}

@Module({ imports: [DbModule, SaasModule] })
class HqBackfillModule {}

const ctx = await NestFactory.createApplicationContext(HqBackfillModule, { logger: false });
try {
  const report = await ctx.get<SaasRunner>(SAAS_RUNNER).reconcile({ dryRun });
  console.log(`${dryRun ? 'dry run: ' : ''}${JSON.stringify(report)}`);
} finally {
  await ctx.close();
}
