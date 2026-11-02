import {
  PutSaasSubscription,
  SAAS_LINKED_FIELDS,
  type SaasSubscriptionDto,
  type SaasSubscriptionHistoryEntry,
  type SaasSubscriptionListQuery,
  type SaasSummary,
} from '@agent-sales/contracts';
import { localDate, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { type HqSubscriptionFacts, SYNC_AUTHOR, sameFacts } from '../domain/hq-mapping.js';
import { STAGE_STATUS, addDays } from '../domain/saas-lead.js';
import { SaasError } from '../domain/saas.errors.js';
import { historyChanged, isUpsell, planMrr, type Usage } from '../domain/subscription-rules.js';
import {
  type HistoryRecord,
  SAAS_STORE,
  type SaasActor,
  type SaasStore,
  type SaasTx,
  type SubscriptionRecord,
} from './ports/saas-store.js';
import { SaasLeadService } from './saas-lead.service.js';
import { publishSubscriptionChanged } from './subscription-events.js';

const PAGE = 100;
const SOON_DAYS = 7;
const SYNC_ACTOR: SaasActor = { userId: null, name: SYNC_AUTHOR };

export function toSubscriptionDto(
  r: SubscriptionRecord,
  contactName: string | null,
): SaasSubscriptionDto {
  const { externalSource, remindersSent: _sent, ...rest } = r;
  return {
    ...rest,
    linked: externalSource ? { source: externalSource } : null,
    upsell: isUpsell(r.usage),
    contactName,
  };
}

const toHistoryDto = ({
  subscriptionId: _s,
  contactId: _c,
  actorUserId: _a,
  ...e
}: HistoryRecord): SaasSubscriptionHistoryEntry => e;

/** What a platform change did (or, in a dry run, would do) to the HQ row. */
export type PlatformApplyOutcome = 'created' | 'updated' | 'unchanged';

/**
 * Plan, stage and MRR of each customer: revenue figures, so readers need contacts.view_all.
 * The stage decides the customer's status (`STAGE_STATUS`), one way: subscription → status. Every
 * change of stage, plan or MRR adds a history row (spec §6.2). A row linked by a sync (Rapiz HQ)
 * keeps its synced fields (`SAAS_LINKED_FIELDS`) read-only for staff (ADR-021 §3).
 */
@Injectable()
export class SaasSubscriptionService {
  constructor(
    @Inject(SAAS_STORE) private readonly store: SaasStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(SaasLeadService) private readonly leads: SaasLeadService,
  ) {}

  async list(
    ws: WorkspaceId,
    q: SaasSubscriptionListQuery,
  ): Promise<{ data: SaasSubscriptionDto[]; nextOffset: number | null }> {
    await this.leads.assertSaas(ws);
    const trialEnds = q.endingSoon ? await this.#soon(ws) : undefined;
    const rows = await this.store.run(ws, (tx) =>
      tx.listSubscriptions({
        stage: q.stage,
        contactIds: q.contactIds,
        trialEnds: trialEnds && { from: trialEnds.today, before: trialEnds.soon },
        offset: q.offset,
      }),
    );
    const page = rows.slice(0, PAGE);
    const names = await this.crm.contactNames(
      ws,
      page.map((r) => r.contactId),
    );
    return {
      data: page.map((r) => toSubscriptionDto(r, names.get(r.contactId) ?? null)),
      nextOffset: rows.length > PAGE ? q.offset + PAGE : null,
    };
  }

  async forContact(ws: WorkspaceId, contactId: string): Promise<SaasSubscriptionDto | null> {
    await this.leads.assertSaas(ws);
    const contact = await this.crm.getContact(ws, contactId);
    const row = await this.store.run(ws, (tx) => tx.findSubscription(contactId));
    return row ? toSubscriptionDto(row, contact.name) : null;
  }

  async history(ws: WorkspaceId, contactId: string): Promise<SaasSubscriptionHistoryEntry[]> {
    await this.leads.assertSaas(ws);
    await this.crm.getContact(ws, contactId);
    return this.store.run(ws, async (tx) => {
      const row = await tx.findSubscription(contactId);
      return row ? (await tx.listHistory(row.id)).map(toHistoryDto) : [];
    });
  }

  async put(
    ws: WorkspaceId,
    contactId: string,
    raw: unknown,
    actor: SaasActor,
  ): Promise<SaasSubscriptionDto> {
    await this.leads.assertSaas(ws);
    const { version, ...input } = PutSaasSubscription.parse(raw);
    const contact = await this.crm.getContact(ws, contactId);
    const row = await this.store.run(ws, async (tx) => {
      await tx.lockKey(`subscription/${contactId}`);
      const existing = await tx.findSubscription(contactId, true);
      if (!existing && version !== null)
        throw new SaasError('CONFLICT', 'The subscription was removed; reload before saving');
      if (existing && version !== existing.version)
        throw new SaasError('CONFLICT', 'The subscription changed; reload before saving');
      if (existing?.externalSource) assertLinkedUnchanged(existing, input);
      const fields = existing?.externalSource ? input : await priced(tx, input, existing);
      const churn =
        fields.stage === 'canceled'
          ? { churnReason: fields.churnReason, churnNote: fields.churnNote }
          : { churnReason: null, churnNote: '' };
      const now = new Date().toISOString();
      const next: SubscriptionRecord = existing
        ? { ...existing, ...fields, ...churn, version: existing.version + 1, updatedAt: now }
        : {
            id: newId(),
            contactId,
            ...fields,
            ...churn,
            externalSource: null,
            usage: null,
            remindersSent: {},
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
      if (existing) await tx.updateSubscription(next);
      else await tx.insertSubscription(next);
      await recordHistory(tx, existing, next, 'staff', actor.userId, now);
      await publishSubscriptionChanged(tx, ws, existing, next, actor.userId, now);
      await tx.audit(
        actor,
        existing ? 'saas.subscription.updated' : 'saas.subscription.created',
        { type: 'saas_subscription', id: next.id },
        existing
          ? {
              stage: { from: existing.stage, to: next.stage },
              mrr: { from: existing.mrr, to: next.mrr },
            }
          : { stage: next.stage, mrr: next.mrr },
      );
      return next;
    });
    // After the commit: the status follows the stage even if staff moved the customer by hand.
    await this.crm.moveContactStatus(ws, contactId, STAGE_STATUS[row.stage], {
      forwardOnly: false,
    });
    return toSubscriptionDto(row, contact.name);
  }

  /**
   * Rapiz HQ: writes the platform's view of an account onto the customer's subscription (found by
   * `external_ref` = account id, else the customer's own row, which becomes linked). Synced fields
   * only; note, seats and churn reason stay staff's. No change → nothing written. `dryRun` writes
   * nothing and reports what would happen.
   */
  async applyPlatform(
    ws: WorkspaceId,
    contactId: string,
    accountId: string,
    facts: HqSubscriptionFacts,
    dryRun = false,
  ): Promise<PlatformApplyOutcome> {
    const outcome = await this.store.run(ws, async (tx) => {
      await tx.lockKey(`subscription/${contactId}`);
      const existing =
        (await tx.findSubscriptionByExternalRef(accountId, true)) ??
        (await tx.findSubscription(contactId, true));
      if (
        existing &&
        existing.externalSource === 'rapiz' &&
        existing.externalRef === accountId &&
        sameFacts(existing, facts)
      )
        return 'unchanged' as const;
      if (dryRun) return existing ? ('updated' as const) : ('created' as const);
      const now = new Date().toISOString();
      const synced = {
        ...facts,
        planId: null,
        externalRef: accountId,
        externalSource: 'rapiz' as const,
      };
      const next: SubscriptionRecord = existing
        ? { ...existing, ...synced, version: existing.version + 1, updatedAt: now }
        : {
            id: newId(),
            contactId,
            ...synced,
            seats: null,
            note: '',
            churnReason: null,
            churnNote: '',
            usage: null,
            remindersSent: {},
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
      if (existing) await tx.updateSubscription(next);
      else await tx.insertSubscription(next);
      await recordHistory(tx, existing, next, 'sync', null, now);
      await publishSubscriptionChanged(tx, ws, existing, next, null, now);
      await tx.audit(
        SYNC_ACTOR,
        'saas.subscription.synced',
        { type: 'saas_subscription', id: next.id },
        { stage: next.stage, mrr: next.mrr },
      );
      return existing ? ('updated' as const) : ('created' as const);
    });
    if (outcome !== 'unchanged' && !dryRun) {
      await this.crm.moveContactStatus(ws, contactId, STAGE_STATUS[facts.stage], {
        forwardOnly: false,
      });
    }
    return outcome;
  }

  /**
   * Rapiz HQ: the latest usage of the account's cycle. Returns whether it newly crossed the upsell
   * line (it was below, or unknown, before); null when the account has no subscription row yet.
   */
  async recordUsage(ws: WorkspaceId, accountId: string, usage: Usage): Promise<boolean | null> {
    return this.store.run(ws, async (tx) => {
      const row = await tx.findSubscriptionByExternalRef(accountId, true);
      if (!row) return null;
      const was = isUpsell(row.usage);
      await tx.updateSubscription({ ...row, usage });
      return !was && isUpsell(usage);
    });
  }

  async summary(ws: WorkspaceId): Promise<SaasSummary> {
    await this.leads.assertSaas(ws);
    const { today, soon } = await this.#soon(ws);
    return this.store.run(ws, (tx) => tx.summary(today, soon));
  }

  /** Today and the day after the "ending soon" window, in the business's own calendar. */
  async #soon(ws: WorkspaceId): Promise<{ today: string; soon: string }> {
    const { timezone } = await this.workspaces.getById(ws);
    const today = localDate(new Date(), timezone);
    return { today, soon: addDays(today, SOON_DAYS) };
  }
}

type Fields = Omit<PutSaasSubscription, 'version'>;

/** A synced field sent with another value than the row's: rejected, the sync owns it. */
function assertLinkedUnchanged(existing: SubscriptionRecord, input: Fields): void {
  const changed = SAAS_LINKED_FIELDS.filter((k) => (existing[k] ?? null) !== (input[k] ?? null));
  if (changed.length) {
    throw new SaasError('VALIDATION_FAILED', 'These fields are synced from Rapiz and read-only', {
      reason: 'LINKED_READ_ONLY',
      fields: Object.fromEntries(changed.map((k) => [k, 'LINKED_READ_ONLY'])),
    });
  }
}

/**
 * With a catalog plan, its name and the MRR for the period come from the plan (spec §6.1). A plan
 * archived since stays on the rows that already had it but cannot be newly chosen.
 */
async function priced(tx: SaasTx, f: Fields, existing: SubscriptionRecord | null): Promise<Fields> {
  if (!f.planId) return f;
  const plan = await tx.findPlan(f.planId);
  if (!plan || (plan.archivedAt && existing?.planId !== plan.id)) {
    throw new SaasError('VALIDATION_FAILED', 'This plan does not exist or is archived', {
      fields: { planId: 'UNKNOWN_PLAN' },
    });
  }
  const mrr = planMrr(plan.prices, f.billingPeriod);
  if (mrr === null) {
    throw new SaasError('VALIDATION_FAILED', 'The plan has no price for this billing period', {
      fields: { billingPeriod: 'NO_PRICE' },
    });
  }
  return { ...f, planName: plan.name, mrr };
}

async function recordHistory(
  tx: SaasTx,
  before: SubscriptionRecord | null,
  after: SubscriptionRecord,
  source: HistoryRecord['source'],
  actorUserId: string | null,
  at: string,
): Promise<void> {
  if (!historyChanged(before, after)) return;
  await tx.insertHistory({
    id: newId(),
    subscriptionId: after.id,
    contactId: after.contactId,
    fromStage: before?.stage ?? null,
    toStage: after.stage,
    fromPlan: before?.planName ?? null,
    toPlan: after.planName,
    fromMrr: before?.mrr ?? null,
    toMrr: after.mrr,
    churnReason: after.stage === 'canceled' ? after.churnReason : null,
    source,
    actorUserId,
    changedAt: at,
  });
}
