/* eslint-disable no-console -- CLI entrypoint */
import { backfillAccounts, createDb } from '@agent-sales/db';

/**
 * `pnpm --filter @agent-sales/backend account-backfill [--dry-run]`
 *
 * ADR-012 §8 step 2 (T-078): one account per workspace owner, `account_id` on every
 * workspace, bot attribution for conversations and analytics facts, broken channel
 * bindings removed. Idempotent; `--dry-run` prints the same report and changes nothing.
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
