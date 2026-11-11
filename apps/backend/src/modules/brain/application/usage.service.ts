import { BRAIN_EVALUATIONS_DAILY, type BrainUsageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BILLING_FACADE, type BillingFacade } from '../../billing/api/index.js';
import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';
import { DEFAULT_DAILY_EVALUATIONS, hcmDay } from '../domain/schedule.js';

/** A reserved evaluation: give it back with `release` when the call fails. */
export interface UsageReservation {
  day: string;
}

/**
 * The daily evaluation cap (spec §3.4): entitlement `brain.evaluations.daily` per business per
 * day in Asia/Ho_Chi_Minh, `null` = unlimited, counted in `signal_usage` before each call.
 */
@Injectable()
export class UsageService {
  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
  ) {}

  /**
   * The plan's limit. A plan that predates the key does not define it, and `BillingFacade.limit`
   * would read that as 0, so the entitlements are read instead (like the API plan gate) and a
   * missing key gets the default of every plan (200).
   */
  async limit(ws: WorkspaceId): Promise<number | null> {
    const { limits } = await this.billing.entitlements(ws);
    return BRAIN_EVALUATIONS_DAILY in limits
      ? (limits[BRAIN_EVALUATIONS_DAILY] ?? null)
      : DEFAULT_DAILY_EVALUATIONS;
  }

  /** Takes one evaluation of today; null when the cap is reached. */
  async reserve(ws: WorkspaceId, now: Date): Promise<UsageReservation | null> {
    const day = hcmDay(now);
    return (await this.store.reserveUsage(ws, day, await this.limit(ws))) ? { day } : null;
  }

  /** Whether today still has an evaluation left (a cheap read; `reserve` decides). */
  async hasRoom(ws: WorkspaceId, now: Date): Promise<boolean> {
    const limit = await this.limit(ws);
    return limit === null || (await this.store.usedOn(ws, hcmDay(now))) < limit;
  }

  release(ws: WorkspaceId, r: UsageReservation): Promise<void> {
    return this.store.releaseUsage(ws, r.day);
  }

  async usage(ws: WorkspaceId, now = new Date()): Promise<BrainUsageDto> {
    const day = hcmDay(now);
    const [used, limit] = await Promise.all([this.store.usedOn(ws, day), this.limit(ws)]);
    return { day, used, limit };
  }
}
