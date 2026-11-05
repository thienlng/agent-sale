import { foldVietnamese } from '@agent-sales/shared';

import type { HoldToolContext } from './hold-tools.js';

/** What `prepare_hold` asked for: the stay, the rooms and the packages by name (T-193). */
export interface RoomsAsk {
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  rooms?: string[] | undefined;
  packages?: { room?: string | undefined; package: string }[] | undefined;
}

export interface ResolvedRooms {
  ids: string[];
  /** `unitId` null = the whole property. */
  packages: { unitId: string | null; name: string }[];
}

/** The property's room names (folded) → id and name, read from its free options. */
async function roomsOf(
  ctx: HoldToolContext,
  ask: RoomsAsk,
  propertyId: string,
): Promise<Map<string, { id: string; name: string }>> {
  const res = await ctx.facade.checkAvailabilityForBot(ctx.ws, {
    botId: ctx.botId,
    checkIn: ask.checkIn,
    checkOut: ask.checkOut,
    adults: ask.adults,
    childAges: ask.childAges,
    propertyId,
  });
  const byName = new Map<string, { id: string; name: string }>();
  for (const o of res.options.filter((x) => x.propertyId === propertyId))
    o.unitNames.forEach((name, i) => {
      const id = o.unitIds[i];
      if (id) byName.set(foldVietnamese(name).trim(), { id, name });
    });
  return byName;
}

/**
 * Room names → ids of the property, and the chosen packages with their room ids (no room = the
 * whole property); `unknown` lists the known rooms when a name is not one of them. The calendar
 * is read only when a room is named.
 */
export async function resolveRooms(
  ctx: HoldToolContext,
  ask: RoomsAsk,
  propertyId: string,
): Promise<ResolvedRooms | { unknown: string[] }> {
  const asked = ask.packages ?? [];
  if (!ask.rooms?.length && asked.every((p) => !p.room))
    return { ids: [], packages: asked.map((p) => ({ unitId: null, name: p.package.trim() })) };
  const byName = await roomsOf(ctx, ask, propertyId);
  // The property is full: the lodging module answers not_available with alternatives.
  if (!byName.size) return { ids: [], packages: [] };
  const idOf = (room: string) => byName.get(foldVietnamese(room).trim())?.id;
  const ids = (ask.rooms ?? []).map(idOf);
  const packages = asked.map((p) => ({
    unitId: p.room ? idOf(p.room) : null,
    name: p.package.trim(),
  }));
  if (ids.some((id) => id === undefined) || packages.some((p) => p.unitId === undefined))
    return { unknown: [...byName.values()].map((u) => u.name) };
  return {
    ids: [...new Set(ids as string[])],
    packages: packages as ResolvedRooms['packages'],
  };
}
