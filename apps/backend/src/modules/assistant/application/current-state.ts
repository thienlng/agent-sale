import type { RouteInvoker } from '../domain/ports/route-invoker.port.js';
import type { CatalogEntry, RouteCatalog } from './route-catalog.js';

/** At most this many ancestor GETs are read to find an item's current state. */
const MAX_PARENT_READS = 2;

/** The first object (depth-first, ≤ 6 levels) whose `id` is exactly `id`. */
export function findById(value: unknown, id: string, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 6) return undefined;
  if (Array.isArray(value)) {
    for (const x of value) {
      const hit = findById(x, id, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const o = value as Record<string, unknown>;
  if (o['id'] === id) return o;
  for (const x of Object.values(o)) {
    const hit = findById(x, id, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export type CurrentState =
  | { found: true; value: unknown }
  /** `viaParent`: the route has no GET of its own and no ancestor GET held the item. */
  | { found: false; viaParent: boolean };

/**
 * The current state of the target of a PATCH/PUT/DELETE on `path`: the GET on the same path,
 * or, for an item route without one (a date-range price under a property), the object with
 * exactly the item's id in the nearest of at most 2 ancestor GETs. Shared by the proposal's
 * `before` snapshot and the stale check at approval, so both read the same thing. Never a guess.
 */
export async function readCurrentState(i: {
  catalog: RouteCatalog;
  invoker: RouteInvoker;
  entry: CatalogEntry;
  path: string;
  businessId: string;
  authorization: string;
}): Promise<CurrentState> {
  const read = (path: string) =>
    i.invoker.invoke({
      method: 'get',
      path,
      businessId: i.businessId,
      authorization: i.authorization,
    });
  if (i.catalog.readerOf(i.entry)) {
    const current = await read(i.path);
    return current.status >= 200 && current.status < 300
      ? { found: true, value: current.body }
      : { found: false, viaParent: false };
  }
  const segments = i.path.split('/');
  const id = segments.at(-1);
  if (id) {
    for (const reader of i.catalog.parentReadersOf(i.entry).slice(0, MAX_PARENT_READS)) {
      const current = await read(segments.slice(0, reader.path.split('/').length).join('/'));
      if (current.status < 200 || current.status >= 300) continue;
      const item = findById(current.body, id);
      if (item !== undefined) return { found: true, value: item };
    }
  }
  return { found: false, viaParent: true };
}
