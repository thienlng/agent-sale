import type { EntitlementsDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { BillingFacade } from '../api/billing.facade.js';
import {
  FREE_PLAN,
  limitOf,
  type PlanRecord,
  resolveEntitlements,
} from '../domain/entitlements.js';
import { PlanNotFoundError } from '../domain/billing.errors.js';
import { BILLING_STORE, type BillingStore } from './ports/billing-store.js';

const PLAN_CACHE_MS = 60_000;

/** Plans and entitlements (docs/08 §3): the plan of the workspace with overrides applied. */
@Injectable()
export class BillingService implements BillingFacade {
  readonly #plans = new Map<string, { at: number; plan: PlanRecord }>();

  constructor(@Inject(BILLING_STORE) private readonly store: BillingStore) {}

  async entitlements(ws: WorkspaceId): Promise<EntitlementsDto> {
    const { subscription, overrides } = await this.store.workspaceState(ws);
    const code = subscription?.planCode ?? FREE_PLAN.code;
    const version = subscription?.planVersion ?? FREE_PLAN.version;
    return resolveEntitlements(await this.#plan(code, version), subscription, overrides);
  }

  async limit(ws: WorkspaceId, key: string): Promise<number | null> {
    return limitOf(await this.entitlements(ws), key);
  }

  /** Plan versions never change once published, so a short cache is always correct. */
  async #plan(code: string, version: number): Promise<PlanRecord> {
    const key = `${code}@${version}`;
    const hit = this.#plans.get(key);
    if (hit && Date.now() - hit.at < PLAN_CACHE_MS) return hit.plan;
    const plan = await this.store.plan(code, version);
    if (!plan) throw new PlanNotFoundError(code, version);
    this.#plans.set(key, { at: Date.now(), plan });
    return plan;
  }
}
