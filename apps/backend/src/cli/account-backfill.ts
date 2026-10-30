/* eslint-disable no-console -- CLI entrypoint */
import { backfillAccountSubscriptions, backfillAccounts, createDb } from '@agent-sales/db';

/**
 * `pnpm --filter @agent-sales/backend account-backfill [--dry-run]`
 *
 * ADR-012 §8 step 2 (T-078): one account per workspace owner, `account_id` on every
 * workspace, bot attribution for conversations and analytics facts, broken channel
 * bindings removed. Then (T-091, ADR-012 §5) each account gets the paid subscription of its
 * businesses. Idempotent; `--dry-run` prints the same reports and changes nothing (the
 * subscription part of a dry run only sees businesses already linked to an account).
 * Uses DATABASE_SYSTEM_URL. The report holds ids and counts only (no names or emails).
 */
const dryRun = process.argv.includes('--dry-run');
const url = process.env['DATABASE_SYSTEM_URL'];
if (!url) {
  console.error('usage: account-backfill [--dry-run]   (needs DATABASE_SYSTEM_URL)');
  process.exit(1);
}

const { db, close } = createDb({ url, max: 1 });
try {
  const report = await backfillAccounts(db, { dryRun });
  console.log(JSON.stringify(report, null, 2));
  const subscriptions = await backfillAccountSubscriptions(db, { dryRun });
  console.log(JSON.stringify({ subscriptions }, null, 2));
  if (subscriptions.conflicts.length)
    console.log(
      `${subscriptions.conflicts.length} account(s) had several paid businesses: the most expensive plan was copied, settle the others by hand`,
    );
  const clean = report.workspacesSkipped.length === 0;
  console.log(
    clean
      ? 'every workspace has an account: the contract migration can run'
      : `${report.workspacesSkipped.length} workspace(s) need an operator before the contract migration`,
  );
  if (!clean) process.exitCode = 2;
} finally {
  await close();
}
