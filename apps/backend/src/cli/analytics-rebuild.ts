/* eslint-disable no-console -- CLI entrypoint */
import { createDb } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import { ProjectorService } from '../modules/analytics/application/projector.service.js';
import { DrizzleFactStore } from '../modules/analytics/infrastructure/persistence/facts.drizzle.js';
import { DrizzleProjectionStore } from '../modules/analytics/infrastructure/persistence/projection.drizzle.js';

/**
 * `pnpm --filter @agent-sales/backend analytics-rebuild <workspace-id>` — forgets one workspace's
 * statistics facts and replays its events from the outbox. Reads the outbox and writes facts only:
 * nothing is sent to customers or channels. Needs DATABASE_URL and DATABASE_SYSTEM_URL.
 */
const [workspaceId] = process.argv.slice(2);
const tenantUrl = process.env['DATABASE_URL'];
const systemUrl = process.env['DATABASE_SYSTEM_URL'];
if (!workspaceId || !tenantUrl || !systemUrl) {
  console.error(
    'usage: analytics-rebuild <workspace-id>   (needs DATABASE_URL and DATABASE_SYSTEM_URL)',
  );
  process.exit(1);
}

const tenant = createDb({ url: tenantUrl, max: 1 });
const system = createDb({ url: systemUrl, max: 1 });
try {
  const projector = new ProjectorService(
    new DrizzleProjectionStore(system.db),
    new DrizzleFactStore(tenant.db),
  );
  const { events, facts } = await projector.rebuild(workspaceId as WorkspaceId);
  console.log(`${workspaceId}: replayed ${events} events into ${facts} facts`);
} finally {
  await Promise.all([tenant.close(), system.close()]);
}
