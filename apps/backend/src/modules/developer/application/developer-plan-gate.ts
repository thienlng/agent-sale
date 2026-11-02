import type { WorkspaceId } from '@agent-sales/shared';

import type { BillingFacade } from '../../billing/api/index.js';
import type { DeveloperPlanGate } from './ports/webhook-transport.js';

const TTL_MS = 60_000;

/**
 * `feature.public_api` from the billing entitlements, cached a minute per workspace: the
 * dispatcher asks for every workspace with endpoints on every pass.
 */
export class BillingDeveloperPlanGate implements DeveloperPlanGate {
  readonly #cache = new Map<string, { at: number; enabled: boolean }>();

  constructor(
    private readonly billing: BillingFacade,
    private readonly clock: () => number = Date.now,
  ) {}

  async enabled(ws: WorkspaceId): Promise<boolean> {
    const now = this.clock();
    const hit = this.#cache.get(ws);
    if (hit && now - hit.at < TTL_MS) return hit.enabled;
    const enabled = (await this.billing.entitlements(ws)).features['feature.public_api'] === true;
    if (this.#cache.size > 10_000) this.#cache.clear();
    this.#cache.set(ws, { at: now, enabled });
    return enabled;
  }
}
