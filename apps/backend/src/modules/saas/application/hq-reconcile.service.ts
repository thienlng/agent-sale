import { Inject, Injectable, Logger } from '@nestjs/common';

import { CONTACT_SYNC_FACADE, type ContactSyncFacade } from '../../crm/api/index.js';
import type { HqReconcileReport } from '../api/saas.runner.js';
import { hqSubscriptionFacts, type HqSubscriptionInput } from '../domain/hq-mapping.js';
import { HqContext } from './hq-context.js';
import {
  PLATFORM_DIRECTORY,
  type PlatformAccount,
  type PlatformDirectory,
} from './ports/platform-directory.js';
import { SAAS_STORE, type SaasStore } from './ports/saas-store.js';
import { SaasSubscriptionService } from './saas-subscription.service.js';

const PAGE = 200;
/** Name of billing's free plan: an account without a subscription row is on it (spec §4). */
const FREE_PLAN_NAME = 'Miễn phí';

/** The platform's current subscription of an account as an event-shaped input. */
function currentSubscription(a: PlatformAccount, now: string): HqSubscriptionInput {
  const s = a.subscription;
  if (!s) {
    return {
      status: 'active',
      planCode: 'free',
      planName: FREE_PLAN_NAME,
      periodMonths: null,
      periodStart: null,
      periodEnd: null,
      mrrVnd: 0,
      occurredAt: now,
    };
  }
  return { ...s, occurredAt: s.since };
}

/**
 * Backfill and nightly reconcile of Rapiz HQ (spec R7): every platform account gets its linked
 * customer (adopted by phone, then email, else created) and its subscription row repaired to the
 * platform's current state. Writes only drift, through the same paths as the live sync, so a clean
 * run changes nothing. The marks it leaves (`applied`) make older live events stale: the state it
 * read already contains them.
 *
 * `dryRun` reads and compares but writes nothing: accounts not linked yet count as `linked` and
 * `subscriptionsCreated` (what a real run would do).
 */
@Injectable()
export class HqReconcileService {
  readonly #log = new Logger(HqReconcileService.name);

  constructor(
    @Inject(HqContext) private readonly hq: HqContext,
    @Inject(PLATFORM_DIRECTORY) private readonly directory: PlatformDirectory,
    @Inject(SAAS_STORE) private readonly store: SaasStore,
    @Inject(CONTACT_SYNC_FACADE) private readonly contacts: ContactSyncFacade,
    @Inject(SaasSubscriptionService) private readonly subscriptions: SaasSubscriptionService,
  ) {}

  async run({ dryRun }: { dryRun: boolean }): Promise<HqReconcileReport> {
    const report: HqReconcileReport = {
      accounts: 0,
      linked: 0,
      subscriptionsCreated: 0,
      subscriptionsUpdated: 0,
      unchanged: 0,
      skipped: 0,
    };
    const target = await this.hq.target();
    if (!target) {
      this.#log.warn(`hq reconcile: off (${this.hq.configured ? 'hq_not_saas' : 'hq_unset'})`);
      return report;
    }
    const { ws, toDate } = target;
    const links = new Map(
      (await this.store.run(ws, (tx) => tx.listHqLinks())).map((l) => [l.accountId, l]),
    );
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<PlatformDirectory['listAccounts']>> =
        await this.directory.listAccounts(cursor, PAGE);
      for (const a of page.data) {
        report.accounts++;
        const now = new Date().toISOString();
        const facts = hqSubscriptionFacts(currentSubscription(a, now), toDate);
        let link = links.get(a.accountId);
        if (!link) {
          report.linked++;
          if (dryRun) {
            report.subscriptionsCreated++;
            continue;
          }
          const res = await this.contacts.upsertExternalContact(ws, 'rapiz', {
            externalId: a.accountId,
            name: a.ownerName,
            phone: a.ownerPhone,
            email: a.ownerEmail,
            address: null,
            birthday: null,
            gender: null,
          });
          if ('skipped' in res) {
            report.linked--;
            report.skipped++;
            continue;
          }
          link = { accountId: a.accountId, contactId: res.contactId, applied: {} };
        }
        const outcome = await this.subscriptions.applyPlatform(
          ws,
          link.contactId,
          a.accountId,
          facts,
          dryRun,
        );
        if (outcome === 'created') report.subscriptionsCreated++;
        else if (outcome === 'updated') report.subscriptionsUpdated++;
        else report.unchanged++;
        if (!dryRun && (outcome !== 'unchanged' || !links.has(a.accountId))) {
          const marks = { created: a.createdAt, subscription: now };
          await this.store.run(ws, async (tx) => {
            await tx.lockKey(`hq/${a.accountId}`);
            const current = await tx.findHqLink(a.accountId, true);
            await tx.saveHqLink({
              accountId: a.accountId,
              contactId: link.contactId,
              applied: { ...(current?.applied ?? {}), ...marks },
            });
          });
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    this.#log.log(`hq reconcile${dryRun ? ' (dry run)' : ''}: ${JSON.stringify(report)}`);
    return report;
  }
}
