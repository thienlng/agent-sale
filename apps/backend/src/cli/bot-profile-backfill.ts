/* eslint-disable no-console -- CLI entrypoint */
import { backfillBotProfiles, createDb } from '@agent-sales/db';

/**
 * `pnpm --filter @agent-sales/backend bot-profile-backfill [--dry-run]`
 *
 * T-141: copies `settings.placeholders` into the structured bot profile, deletes seeded FAQs
 * and "every reply" style rules that are still exactly the legacy seed, and maps the length
 * rule to `replyLength`. Edited and user-written items are kept. Idempotent; `--dry-run`
 * prints the same per-bot counts and changes nothing. Uses DATABASE_SYSTEM_URL. The report
 * holds ids and counts only (no business text).
 */
const dryRun = process.argv.includes('--dry-run');
const url = process.env['DATABASE_SYSTEM_URL'];
if (!url) {
  console.error('usage: bot-profile-backfill [--dry-run]   (needs DATABASE_SYSTEM_URL)');
  process.exit(1);
}

const { db, close } = createDb({ url, max: 1 });
try {
  const report = await backfillBotProfiles(db, { dryRun });
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `${dryRun ? 'would change' : 'changed'} ${report.bots.length} bot(s); a second run reports none`,
  );
} finally {
  await close();
}
