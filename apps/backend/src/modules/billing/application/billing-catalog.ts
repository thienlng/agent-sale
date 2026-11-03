import { Inject, Injectable } from '@nestjs/common';

import { PlanNotFoundError } from '../domain/billing.errors.js';
import type { PlanRecord } from '../domain/entitlements.js';
import type { CatalogPlan } from '../domain/plan-catalog.js';
import {
  BILLING_ADMIN_STORE,
  type BillingAdminStore,
  type BillingSettings,
} from './ports/billing-admin-store.js';
import { BILLING_STORE, type BillingStore } from './ports/billing-store.js';

const CACHE_MS = 60_000;

/**
 * Short caches of the plan catalog and the billing settings for the hot paths (entitlements,
 * reservations). Admin writes call `invalidate()`; other processes see a change within a minute.
 */
@Injectable()
export class BillingCatalog {
  readonly #versions = new Map<string, { at: number; plan: PlanRecord }>();
  readonly #latest = new Map<string, { at: number; plan: CatalogPlan | null }>();
  #settings: { at: number; value: BillingSettings } | null = null;

  constructor(
    @Inject(BILLING_STORE) private readonly store: BillingStore,
    @Inject(BILLING_ADMIN_STORE) private readonly admin: BillingAdminStore,
  ) {}

  /** Plan versions never change once published, so a short cache is always correct. */
  async plan(code: string, version: number): Promise<PlanRecord> {
    const key = `${code}@${version}`;
    const hit = this.#versions.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;
    const plan = await this.store.plan(code, version);
    if (!plan) throw new PlanNotFoundError(code, version);
    this.#versions.set(key, { at: Date.now(), plan });
    return plan;
  }

  /** The newest version of a code (what new subscriptions get), or null for an unknown code. */
  async latest(code: string): Promise<CatalogPlan | null> {
    const hit = this.#latest.get(code);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;
    const plan = await this.admin.latestPlan(code);
    this.#latest.set(code, { at: Date.now(), plan });
    return plan;
  }

  async settings(): Promise<BillingSettings> {
    if (this.#settings && Date.now() - this.#settings.at < CACHE_MS) return this.#settings.value;
    const value = await this.admin.settings();
    this.#settings = { at: Date.now(), value };
    return value;
  }

  invalidate(): void {
    this.#latest.clear();
    this.#settings = null;
  }
}
