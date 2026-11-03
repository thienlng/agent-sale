import {
  AccountCreatedV1,
  AccountStatusChangedV1,
  SubscriptionChangedV1,
  SubscriptionReminderV1,
  UsageSnapshotV1,
} from '@agent-sales/contracts';
import { DomainError } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import {
  CONTACT_SYNC_FACADE,
  CRM_FACADE,
  type ContactSyncFacade,
  type CrmFacade,
} from '../../../crm/api/index.js';
import {
  ACCOUNT_STATUS_NOTE,
  hqSubscriptionFacts,
  reminderNote,
  SYNC_AUTHOR,
  upsellNote,
} from '../../domain/hq-mapping.js';
import { HqContext, type HqTarget } from '../hq-context.js';
import type { HqLinkRecord } from '../ports/saas-store.js';
import { SAAS_STORE, type SaasStore } from '../ports/saas-store.js';
import {
  type HqOutboxRow,
  SAAS_SYSTEM_STORE,
  type SaasSystemStore,
} from '../ports/saas-system-store.js';
import { SaasSubscriptionService } from '../saas-subscription.service.js';

const HqEvent = z.discriminatedUnion('type', [
  AccountCreatedV1,
  AccountStatusChangedV1,
  SubscriptionChangedV1,
  UsageSnapshotV1,
  SubscriptionReminderV1,
]);
type HqEvent = z.infer<typeof HqEvent>;

export const HQ_EVENT_TYPES = [
  'account.account.created.v1',
  'account.account.status_changed.v1',
  'billing.subscription.changed.v1',
  'billing.usage.snapshot.v1',
  'billing.subscription.reminder.v1',
] as const satisfies readonly HqEvent['type'][];

/** Ordering key per event kind in `saas_hq_links.applied`. */
const KIND: Record<HqEvent['type'], string> = {
  'account.account.created.v1': 'created',
  'account.account.status_changed.v1': 'status',
  'billing.subscription.changed.v1': 'subscription',
  'billing.usage.snapshot.v1': 'usage',
  'billing.subscription.reminder.v1': 'reminder',
};

const BATCH = 200;

/** What one event did; logged as counts per code, never with customer data. */
export type HqApplyCode =
  | 'linked'
  | 'subscription_created'
  | 'subscription_updated'
  | 'note_added'
  | 'usage_recorded'
  | 'stale'
  | 'duplicate'
  | 'unlinked'
  | 'no_identity'
  | 'no_subscription'
  | 'unchanged';

const newer = (at: string, applied: string | undefined) =>
  !applied || Date.parse(at) > Date.parse(applied);

/**
 * Rapiz HQ sync (ADR-021, spec R5–R7): mirrors platform accounts into the HQ business as linked
 * customers with a subscription. Reads the account and billing events from the outbox like the
 * analytics projector (transaction horizon, exclusive lease, position committed after the pass)
 * and writes only through the CRM facades and the saas services.
 *
 * Idempotent and order-tolerant per account: `saas_hq_links.applied` keeps the `occurredAt` of the
 * last applied event of each kind, and an event not newer than it is ignored; a reminder is keyed
 * by kind and due date. A payload it cannot read, or one the CRM refuses, is dead-lettered; a
 * database failure stops the pass, which is retried whole on the next tick.
 */
@Injectable()
export class HqSyncHandler {
  readonly #log = new Logger(HqSyncHandler.name);

  constructor(
    @Inject(HqContext) private readonly hq: HqContext,
    @Inject(SAAS_SYSTEM_STORE) private readonly system: SaasSystemStore,
    @Inject(SAAS_STORE) private readonly store: SaasStore,
    @Inject(CONTACT_SYNC_FACADE) private readonly contacts: ContactSyncFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(SaasSubscriptionService) private readonly subscriptions: SaasSubscriptionService,
  ) {}

  async tick(): Promise<number> {
    const target = await this.hq.target();
    if (!target) return 0;
    const counts = new Map<string, number>();
    const read = await this.system.withHqLease(async (lease) => {
      let after = 0;
      let n = 0;
      for (;;) {
        const rows = await lease.readBatch(HQ_EVENT_TYPES, after, BATCH);
        if (!rows.length) break;
        for (const row of rows) {
          const code = await this.#one(target, row, (r, e) => lease.deadLetter(r, e));
          counts.set(code, (counts.get(code) ?? 0) + 1);
        }
        n += rows.length;
        after = rows.reduce((max, r) => Math.max(max, r.id), after);
      }
      await lease.commit();
      return n;
    });
    if (read)
      this.#log.log(`hq sync: ${read} events ${JSON.stringify(Object.fromEntries(counts))}`);
    return read ?? 0;
  }

  async #one(
    target: HqTarget,
    row: HqOutboxRow,
    deadLetter: (row: HqOutboxRow, error: string) => Promise<void>,
  ): Promise<HqApplyCode | 'dead_letter'> {
    const parsed = HqEvent.safeParse({ ...row.payload, type: row.type });
    if (!parsed.success) {
      await deadLetter(row, 'INVALID_PAYLOAD');
      return 'dead_letter';
    }
    try {
      return await this.apply(target, parsed.data);
    } catch (e) {
      // A rule the CRM or saas refuses will refuse again: park it. Anything else is retried.
      if (!(e instanceof DomainError)) throw e;
      await deadLetter(row, e.code);
      return 'dead_letter';
    }
  }

  /** Applies one event to HQ. Public for the tests; the tick is the only production caller. */
  async apply(target: HqTarget, e: HqEvent): Promise<HqApplyCode> {
    const { ws } = target;
    const link = await this.store.run(ws, (tx) => tx.findHqLink(e.accountId));
    if (e.type === 'account.account.created.v1') {
      if (link && !newer(e.occurredAt, link.applied['created'])) return 'duplicate';
      const res = await this.contacts.upsertExternalContact(ws, 'rapiz', {
        externalId: e.accountId,
        name: e.ownerName || e.name,
        phone: e.ownerPhone,
        email: e.ownerEmail,
        address: null,
        birthday: null,
        gender: null,
      });
      if ('skipped' in res) return 'no_identity';
      await this.#mark(target, e.accountId, res.contactId, { created: e.occurredAt });
      return 'linked';
    }
    if (!link) return 'unlinked';
    const kind = KIND[e.type];
    switch (e.type) {
      case 'account.account.status_changed.v1': {
        if (!newer(e.occurredAt, link.applied[kind])) return 'stale';
        await this.crm.addContactNote(
          ws,
          link.contactId,
          ACCOUNT_STATUS_NOTE[e.status],
          SYNC_AUTHOR,
        );
        await this.#mark(target, e.accountId, link.contactId, { [kind]: e.occurredAt });
        return 'note_added';
      }
      case 'billing.subscription.changed.v1': {
        if (!newer(e.occurredAt, link.applied[kind])) return 'stale';
        const outcome = await this.subscriptions.applyPlatform(
          ws,
          link.contactId,
          e.accountId,
          hqSubscriptionFacts(e, target.toDate),
        );
        await this.#mark(target, e.accountId, link.contactId, { [kind]: e.occurredAt });
        return outcome === 'unchanged' ? 'unchanged' : `subscription_${outcome}`;
      }
      case 'billing.usage.snapshot.v1': {
        if (!newer(e.occurredAt, link.applied[kind])) return 'stale';
        const crossed = await this.subscriptions.recordUsage(ws, e.accountId, {
          used: e.used,
          limit: e.limit,
          at: e.occurredAt,
        });
        if (crossed === null) return 'no_subscription';
        if (crossed)
          await this.crm.addContactNote(
            ws,
            link.contactId,
            upsellNote(e.used, e.limit),
            SYNC_AUTHOR,
          );
        await this.#mark(target, e.accountId, link.contactId, { [kind]: e.occurredAt });
        return crossed ? 'note_added' : 'usage_recorded';
      }
      case 'billing.subscription.reminder.v1': {
        const key = `reminder:${e.kind}:${e.dueAt}`;
        if (link.applied[key]) return 'duplicate';
        const note = reminderNote(e.kind, target.toDate(e.dueAt), e.daysLeft);
        await this.crm.addContactNote(ws, link.contactId, note, SYNC_AUTHOR);
        await this.#mark(target, e.accountId, link.contactId, { [key]: e.occurredAt });
        return 'note_added';
      }
    }
  }

  /** Merges applied marks into the account's link (re-read under lock: no lost update). */
  async #mark(
    target: HqTarget,
    accountId: string,
    contactId: string,
    marks: Record<string, string>,
  ): Promise<void> {
    await this.store.run(target.ws, async (tx) => {
      await tx.lockKey(`hq/${accountId}`);
      const current = await tx.findHqLink(accountId, true);
      const link: HqLinkRecord = {
        accountId,
        contactId,
        applied: { ...(current?.applied ?? {}), ...marks },
      };
      await tx.saveHqLink(link);
    });
  }
}
