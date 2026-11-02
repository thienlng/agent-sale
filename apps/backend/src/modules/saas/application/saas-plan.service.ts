import { CreateSaasPlan, type SaasPlanDto, UpdateSaasPlan } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SaasError } from '../domain/saas.errors.js';
import { type PlanRecord, SAAS_STORE, type SaasActor, type SaasStore } from './ports/saas-store.js';
import { SaasLeadService } from './saas-lead.service.js';

const toPlanDto = ({ archivedAt, ...p }: PlanRecord): SaasPlanDto => ({
  ...p,
  archived: archivedAt !== null,
});

/**
 * The business's own plan catalog (spec §6.1): a name and a price per billing period, so a
 * subscription's MRR is computed from it. A plan is archived, never deleted: subscriptions keep it.
 */
@Injectable()
export class SaasPlanService {
  constructor(
    @Inject(SAAS_STORE) private readonly store: SaasStore,
    @Inject(SaasLeadService) private readonly leads: SaasLeadService,
  ) {}

  async list(ws: WorkspaceId): Promise<SaasPlanDto[]> {
    await this.leads.assertSaas(ws);
    return this.store.run(ws, async (tx) => (await tx.listPlans(true)).map(toPlanDto));
  }

  async create(ws: WorkspaceId, raw: unknown, actor: SaasActor): Promise<SaasPlanDto> {
    await this.leads.assertSaas(ws);
    const input = CreateSaasPlan.parse(raw);
    return this.store.run(ws, async (tx) => {
      const now = new Date().toISOString();
      const plan: PlanRecord = {
        id: newId(),
        name: input.name,
        prices: input.prices as Record<string, number>,
        position: input.position,
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insertPlan(plan);
      await tx.audit(actor, 'saas.plan.created', { type: 'saas_plan', id: plan.id }, {});
      return toPlanDto(plan);
    });
  }

  async update(
    ws: WorkspaceId,
    planId: string,
    raw: unknown,
    actor: SaasActor,
  ): Promise<SaasPlanDto> {
    await this.leads.assertSaas(ws);
    const { expectedVersion, archived, ...input } = UpdateSaasPlan.parse(raw);
    return this.store.run(ws, async (tx) => {
      const plan = await tx.findPlan(planId, true);
      if (!plan) throw new SaasError('NOT_FOUND', 'Plan not found');
      if (plan.version !== expectedVersion)
        throw new SaasError('CONFLICT', 'The plan changed; reload before saving');
      const now = new Date().toISOString();
      const next: PlanRecord = {
        ...plan,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.prices !== undefined && { prices: input.prices as Record<string, number> }),
        ...(input.position !== undefined && { position: input.position }),
        archivedAt:
          archived === undefined ? plan.archivedAt : archived ? (plan.archivedAt ?? now) : null,
        version: plan.version + 1,
        updatedAt: now,
      };
      await tx.updatePlan(next);
      await tx.audit(
        actor,
        'saas.plan.updated',
        { type: 'saas_plan', id: plan.id },
        archived === undefined ? {} : { archived },
      );
      return toPlanDto(next);
    });
  }
}
