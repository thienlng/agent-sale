import type { WorkspaceId } from '@agent-sales/shared';

import type { BillingFacade } from '../../billing/api/index.js';
import type { ApiPlanGate } from './ports/api-keys.js';

const TTL_MS = 60_000;

/**
 * The public API rights of a workspace from its billing entitlements (`feature.public_api`,
 * `api.requests_per_minute`), cached a minute per workspace so a key's requests do not resolve
 * the plan each time. A plan change or an operator override applies within that minute.
 */
export class BillingApiPlanGate implements ApiPlanGate {
  readonly #cache = new Map<
    string,
    { at: number; value: { enabled: boolean; perMinute: number | null } }
  >();

  constructor(
    private readonly billing: BillingFacade,
    private readonly clock: () => number = Date.now,
  ) {}

  async of(ws: WorkspaceId): Promise<{ enabled: boolean; perMinute: number | null }> {
    const now = this.clock();
    const hit = this.#cache.get(ws);
    if (hit && now - hit.at < TTL_MS) return hit.value;
    const e = await this.billing.entitlements(ws);
    const perMinute =
      'api.requests_per_minute' in e.limits ? (e.limits['api.requests_per_minute'] ?? null) : 0;
    const value = {
      enabled: e.features['feature.public_api'] === true && perMinute !== 0,
      perMinute,
    };
    if (this.#cache.size > 10_000) this.#cache.clear();
    this.#cache.set(ws, { at: now, value });
    return value;
  }
}
