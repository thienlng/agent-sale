import type { AvailabilityDto, CalendarDto } from '@agent-sales/contracts';

import { nightsBetween } from './format';

export type CalendarPropertyData = CalendarDto['properties'][number];
export type CalendarRowData = CalendarPropertyData['rows'][number];
export type CalendarSegmentData = CalendarRowData['segments'][number];
export type AvailabilityOptionData = AvailabilityDto['options'][number];

/** The segment occupying each displayed night of a row (null = free). */
export function takenByNight(
  row: CalendarRowData,
  nights: string[],
): Array<CalendarSegmentData | null> {
  const out: Array<CalendarSegmentData | null> = nights.map(() => null);
  const first = nights[0];
  if (!first) return out;
  for (const s of row.segments) {
    const start = Math.max(0, nightsBetween(first, s.from));
    const end = Math.min(nights.length, nightsBetween(first, s.to));
    for (let i = start; i < end; i++) out[i] = s;
  }
  return out;
}

/** Bars of a row as column spans [start, end) within the displayed nights. */
export function segmentSpans(row: CalendarRowData, nights: string[]) {
  const first = nights[0];
  if (!first) return [];
  return row.segments
    .map((s) => ({
      segment: s,
      start: Math.max(0, nightsBetween(first, s.from)),
      end: Math.min(nights.length, nightsBetween(first, s.to)),
    }))
    .filter((s) => s.end > s.start);
}

/** Taken / total units per night over the given properties, and the overall percentage. */
export function occupancy(properties: CalendarPropertyData[], nights: string[]) {
  return rowOccupancy(
    properties.flatMap((p) => p.rows),
    nights,
  );
}

/** Taken / total units per night over the given unit rows, and the overall percentage. */
export function rowOccupancy(rows: CalendarRowData[], nights: string[]) {
  const taken = nights.map(() => 0);
  for (const row of rows)
    takenByNight(row, nights).forEach((s, i) => {
      if (s) taken[i] = (taken[i] ?? 0) + 1;
    });
  const total = rows.length;
  const sum = taken.reduce((a, b) => a + b, 0);
  const pct = total && nights.length ? Math.round((sum / (total * nights.length)) * 100) : 0;
  return { taken, total, pct };
}

/** True when some unit of the property has at least one free displayed night. */
export function hasFreeNight(property: CalendarPropertyData, nights: string[]): boolean {
  return property.rows.some((row) => takenByNight(row, nights).some((s) => s === null));
}

/** Best availability option per property (the API sorts fitting options first). */
export function bestOptions(
  options: AvailabilityOptionData[],
): Map<string, AvailabilityOptionData> {
  const map = new Map<string, AvailabilityOptionData>();
  for (const o of options) if (!map.has(o.propertyId)) map.set(o.propertyId, o);
  return map;
}

/** Distinct non-empty override labels per displayed night (header chips such as "Tết"). */
export function nightLabels(properties: CalendarPropertyData[], nights: string[]): string[] {
  return nights.map((night) => {
    for (const p of properties) {
      const label =
        p.wholePrices.find((n) => n.night === night)?.label ||
        p.rows.flatMap((r) => r.prices).find((n) => n.night === night && n.label)?.label;
      if (label) return label;
    }
    return '';
  });
}

/** Night note text of a property by unit (null = the property itself) and night. */
export function nightNoteLookup(
  notes: CalendarPropertyData['notes'],
): (unitId: string | null, night: string) => string | undefined {
  const map = new Map(notes.map((n) => [`${n.unitId ?? ''}|${n.night}`, n.text]));
  return (unitId, night) => map.get(`${unitId ?? ''}|${night}`);
}
