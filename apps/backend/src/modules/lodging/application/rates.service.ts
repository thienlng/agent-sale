import type {
  CreateOverrideRequest,
  PropertyDto,
  PutRatesRequest,
  UpdateOverrideRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { LodgingError } from '../domain/lodging.errors.js';
import { assertNoOverrideOverlap, assertWeekdayCoverage, type RateRule } from '../domain/rates.js';
import { LodgingAccess } from './lodging-access.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';
import { assertRateTarget, lockForWrite, readProperty, saveBumped } from './property-support.js';

type OverrideFields = Omit<CreateOverrideRequest, 'version'>;

function overrideRule(id: string, o: OverrideFields): RateRule {
  return {
    id,
    unitId: o.unitId,
    kind: 'override',
    weekdays: [],
    dateFrom: o.dateFrom,
    dateTo: o.dateTo,
    label: o.label,
    sell: o.sell,
    cost: o.cost,
    minNights: o.minNights,
  };
}

/** Weekday rates, surcharges and date-range overrides of one property (spec §3.3). */
@Injectable()
export class RatesService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  /**
   * Replaces every weekday rule and the surcharges. Each target given — and every active room of
   * a `rooms` property — must price the seven weekdays exactly once.
   */
  async putRates(
    ws: WorkspaceId,
    id: string,
    input: PutRatesRequest,
    actorId: string,
  ): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await lockForWrite(tx, id, input.version);
      const units = await tx.units([p.id]);
      for (const r of input.weekday) assertRateTarget(p, units, r.unitId);
      const targets = new Set<string | null>(input.weekday.map((r) => r.unitId));
      if (p.sellMode === 'whole') targets.add(null);
      else units.filter((u) => u.kind === 'room' && u.active).forEach((u) => targets.add(u.id));
      const rules: RateRule[] = input.weekday.map((r) => ({
        id: newId(),
        unitId: r.unitId,
        kind: 'weekday',
        weekdays: r.weekdays,
        dateFrom: null,
        dateTo: null,
        label: '',
        sell: r.sell,
        cost: r.cost,
        minNights: null,
      }));
      assertWeekdayCoverage(rules, [...targets]);
      await tx.replaceWeekdayRates(p.id, rules);
      const saved = await saveBumped(tx, { ...p, surcharges: input.surcharges });
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.rates_replaced', {
        rules: rules.length,
      });
      return readProperty(tx, saved);
    });
  }

  async createOverride(
    ws: WorkspaceId,
    id: string,
    input: CreateOverrideRequest,
    actorId: string,
  ): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await lockForWrite(tx, id, input.version);
      assertRateTarget(p, await tx.units([p.id]), input.unitId);
      const rule = overrideRule(newId(), input);
      assertNoOverrideOverlap([...(await tx.rates([p.id])), rule]);
      await tx.insertOverride(p.id, rule);
      const saved = await saveBumped(tx, p);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.override_added', {
        rateId: rule.id,
        dateFrom: rule.dateFrom,
        dateTo: rule.dateTo,
      });
      return readProperty(tx, saved);
    });
  }

  /** Partial edit; omitted fields keep their stored values. */
  async updateOverride(
    ws: WorkspaceId,
    id: string,
    rateId: string,
    input: UpdateOverrideRequest,
    actorId: string,
  ): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await lockForWrite(tx, id, input.version);
      const rules = await tx.rates([p.id]);
      const current = rules.find((r) => r.id === rateId && r.kind === 'override');
      if (!current) throw new LodgingError('NOT_FOUND', 'Date-range price not found');
      const { version: _v, ...patch } = input;
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<OverrideFields>;
      const rule: RateRule = { ...current, ...defined };
      assertRateTarget(p, await tx.units([p.id]), rule.unitId);
      assertNoOverrideOverlap(rules.map((r) => (r.id === rateId ? rule : r)));
      await tx.updateOverride(p.id, rule);
      const saved = await saveBumped(tx, p);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.override_updated', {
        rateId,
        fields: Object.keys(defined),
      });
      return readProperty(tx, saved);
    });
  }

  async deleteOverride(
    ws: WorkspaceId,
    id: string,
    rateId: string,
    version: number,
    actorId: string,
  ): Promise<PropertyDto> {
    await this.access.assertHotel(ws);
    return this.store.run(ws, async (tx) => {
      const p = await lockForWrite(tx, id, version);
      if (!(await tx.deleteOverride(p.id, rateId)))
        throw new LodgingError('NOT_FOUND', 'Date-range price not found');
      const saved = await saveBumped(tx, p);
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.override_removed', {
        rateId,
      });
      return readProperty(tx, saved);
    });
  }
}
