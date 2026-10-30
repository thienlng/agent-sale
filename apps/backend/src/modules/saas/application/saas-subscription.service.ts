import {
  PutSaasSubscription,
  type SaasSubscriptionDto,
  type SaasSubscriptionListQuery,
  type SaasSummary,
} from '@agent-sales/contracts';
import { localDate, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { addDays } from '../domain/saas-request.js';
import { SaasError } from '../domain/saas.errors.js';
import {
  SAAS_STORE,
  type SaasActor,
  type SaasStore,
  type SubscriptionRecord,
} from './ports/saas-store.js';
import { SaasRequestService } from './saas-request.service.js';

const PAGE = 100;
const SOON_DAYS = 7;

/** Plan, stage and MRR of each customer: revenue figures, so readers need contacts.view_all. */
@Injectable()
export class SaasSubscriptionService {
  constructor(
    @Inject(SAAS_STORE) private readonly store: SaasStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(SaasRequestService) private readonly requests: SaasRequestService,
  ) {}

  async list(
    ws: WorkspaceId,
    q: SaasSubscriptionListQuery,
  ): Promise<{ data: SaasSubscriptionDto[]; nextOffset: number | null }> {
    await this.requests.assertSaas(ws);
    const rows = await this.store.run(ws, (tx) => tx.listSubscriptions(q));
    const page = rows.slice(0, PAGE);
    const names = await this.crm.contactNames(
      ws,
      page.map((r) => r.contactId),
    );
    return {
      data: page.map((r) => ({ ...r, contactName: names.get(r.contactId) ?? null })),
      nextOffset: rows.length > PAGE ? q.offset + PAGE : null,
    };
  }

  async forContact(ws: WorkspaceId, contactId: string): Promise<SaasSubscriptionDto | null> {
    await this.requests.assertSaas(ws);
    const contact = await this.crm.getContact(ws, contactId);
    const row = await this.store.run(ws, (tx) => tx.findSubscription(contactId));
    return row ? { ...row, contactName: contact.name } : null;
  }

  async put(
    ws: WorkspaceId,
    contactId: string,
    raw: unknown,
    actor: SaasActor,
  ): Promise<SaasSubscriptionDto> {
    await this.requests.assertSaas(ws);
    const { version, ...fields } = PutSaasSubscription.parse(raw);
    const contact = await this.crm.getContact(ws, contactId);
    const row = await this.store.run(ws, async (tx) => {
      await tx.lockKey(`subscription/${contactId}`);
      const existing = await tx.findSubscription(contactId, true);
      const now = new Date().toISOString();
      if (!existing) {
        if (version !== null)
          throw new SaasError('CONFLICT', 'The subscription was removed; reload before saving');
        const created: SubscriptionRecord = {
          id: newId(),
          contactId,
          ...fields,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await tx.insertSubscription(created);
        await tx.audit(
          actor,
          'saas.subscription.created',
          {
            type: 'saas_subscription',
            id: created.id,
          },
          { stage: fields.stage, mrr: fields.mrr },
        );
        return created;
      }
      if (version !== existing.version)
        throw new SaasError('CONFLICT', 'The subscription changed; reload before saving');
      const next: SubscriptionRecord = {
        ...existing,
        ...fields,
        version: existing.version + 1,
        updatedAt: now,
      };
      await tx.updateSubscription(next);
      await tx.audit(
        actor,
        'saas.subscription.updated',
        {
          type: 'saas_subscription',
          id: next.id,
        },
        {
          stage: { from: existing.stage, to: next.stage },
          mrr: { from: existing.mrr, to: next.mrr },
        },
      );
      return next;
    });
    return { ...row, contactName: contact.name };
  }

  async summary(ws: WorkspaceId): Promise<SaasSummary> {
    await this.requests.assertSaas(ws);
    const { timezone } = await this.workspaces.getById(ws);
    const today = localDate(new Date(), timezone);
    return this.store.run(ws, (tx) => tx.summary(today, addDays(today, SOON_DAYS)));
  }
}
