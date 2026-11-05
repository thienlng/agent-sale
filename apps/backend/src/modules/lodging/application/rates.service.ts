import type {
  CreateOverrideRequest,
  PropertyDto,
  PutRatesRequest,
  UpdateOverrideRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { LodgingError } from '../domain/lodging.errors.js';
import {
  assertNoOverrideOverlap,
  assertPackages,
  assertRateCoverage,
  assertRatePackage,
  fullPackage,
  type RateRule,
} from '../domain/rates.js';
import { LodgingAccess } from './lodging-access.js';
import {
  LODGING_STORE,
  type LodgingStore,
  type PackageRecord,
  type PropertyRecord,
  type UnitRecord,
} from './ports/lodging-store.js';
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
    packageId: o.packageId,
  };
}

/**
 * The packages a PUT /rates leaves, in request order: a given `id` must be a package of this
 * property (kept), a new one gets a fresh id; keys and ids appear once. Each target must be a
 * rate target of the property (the database does not check that a unit belongs to it), and a
 * new package needs an active target.
 */
function nextPackages(
  p: PropertyRecord,
  units: UnitRecord[],
  stored: PackageRecord[],
  input: PutRatesRequest['packages'],
): PackageRecord[] {
  const keys = new Set<string>();
  const ids = new Set<string>();
  const storedIds = new Set(stored.filter((pk) => pk.propertyId === p.id).map((pk) => pk.id));
  return input.map((pk, i) => {
    if (keys.has(pk.key)) {
      throw new LodgingError('VALIDATION_FAILED', 'A package key is listed twice', {
        key: pk.key,
      });
    }
    keys.add(pk.key);
    if (pk.id !== undefined) {
      if (ids.has(pk.id) || !storedIds.has(pk.id)) {
        throw new LodgingError(
          'VALIDATION_FAILED',
          'A package is listed twice or is not one of this property',
          { packageId: pk.id },
        );
      }
      ids.add(pk.id);
    }
    assertRateTarget(p, units, pk.unitId);
    const unit = units.find((u) => u.id === pk.unitId);
    if (pk.id === undefined && unit && !unit.active) {
      throw new LodgingError('VALIDATION_FAILED', 'A new package needs an active room', {
        unitId: pk.unitId,
      });
    }
    return {
      id: pk.id ?? newId(),
      propertyId: p.id,
      unitId: pk.unitId,
      name: pk.name,
      bedrooms: pk.bedrooms,
      standardAdults: pk.standardAdults,
      standardChildren: pk.standardChildren,
      maxGuests: pk.maxGuests,
      sortOrder: i,
    };
  });
}

/** Weekday rates, surcharges and date-range overrides of one property (spec §3.3). */
@Injectable()
export class RatesService {
  constructor(
    @Inject(LODGING_STORE) private readonly store: LodgingStore,
    @Inject(LodgingAccess) private readonly access: LodgingAccess,
  ) {}

  /**
   * Replaces every weekday rule, the bedroom packages and the surcharges. Each target given — and
   * every active room of a `rooms` property — must price the seven weekdays exactly once, or,
   * with packages, through its full package (`assertRateCoverage`). Rates name new packages by
   * `packageKey`. Stored overrides stay and are checked with the new set; an override of a
   * removed package is deleted with it (cascade), and a package-less override of a target that
   * now has packages moves onto that target's full package.
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
      const packages = nextPackages(p, units, await tx.packages([p.id]), input.packages);
      const idOf = new Map(input.packages.map((pk, i) => [pk.key, packages[i]?.id ?? '']));
      for (const r of input.weekday) assertRateTarget(p, units, r.unitId);
      const targets = new Set<string | null>([
        ...input.weekday.map((r) => r.unitId),
        ...packages.map((pk) => pk.unitId),
      ]);
      if (p.sellMode === 'whole') targets.add(null);
      else units.filter((u) => u.kind === 'room' && u.active).forEach((u) => targets.add(u.id));
      const rules: RateRule[] = input.weekday.map((r) => {
        const packageId = r.packageKey === null ? null : idOf.get(r.packageKey);
        if (packageId === undefined) {
          throw new LodgingError('VALIDATION_FAILED', 'A rate names an unknown package key', {
            unitId: r.unitId,
            packageKey: r.packageKey,
          });
        }
        return {
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
          packageId,
        };
      });
      const kept = new Set(packages.map((pk) => pk.id));
      // A package-less override of a target that now has packages moves onto its full package.
      const moved: RateRule[] = [];
      const overrides = (await tx.rates([p.id]))
        .filter((r) => r.kind === 'override' && (r.packageId === null || kept.has(r.packageId)))
        .map((r) => {
          const full = r.packageId === null ? fullPackage(packages, r.unitId) : undefined;
          if (!full) return r;
          const next = { ...r, packageId: full.id };
          moved.push(next);
          return next;
        });
      assertPackages(packages, [...targets]);
      assertRateCoverage([...rules, ...overrides], [...targets], packages);
      assertNoOverrideOverlap(overrides);
      await tx.replacePackages(p.id, packages);
      await tx.replaceWeekdayRates(p.id, rules);
      for (const r of moved) await tx.updateOverride(p.id, r);
      const saved = await saveBumped(tx, { ...p, surcharges: input.surcharges });
      await tx.audit(actorId, 'lodging_property', p.id, 'lodging.property.rates_replaced', {
        rules: rules.length,
        packages: packages.length,
        overridesMoved: moved.length,
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
      assertRatePackage(rule, await tx.packages([p.id]));
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
      assertRatePackage(rule, await tx.packages([p.id]));
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
