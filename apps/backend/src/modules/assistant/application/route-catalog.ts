import { allRoutes, routeKey, type RouteContract } from '@agent-sales/contracts';
import type { ZodObject, ZodType } from 'zod';

import { foldText } from '../domain/search-text.js';

/** One route the assistant may use (spec §6): `read` runs, `write` becomes a proposal. */
export interface CatalogEntry {
  /** `METHOD /path`, e.g. `PATCH /products/{productId}`. */
  key: string;
  use: 'read' | 'write';
  summary: string;
  when: string;
  method: RouteContract['method'];
  /** Relative to `/api/v1`, with `{param}` placeholders. */
  path: string;
  pathParams: string[];
  query?: ZodObject;
  body?: ZodType;
  /** A side-effect-free query sent as POST with a body (ruling 1b-R7). */
  queryPost?: true;
}

export interface RouteCatalog {
  entries: readonly CatalogEntry[];
  get(key: string): CatalogEntry | undefined;
  /** A GET on the same path (the current state shown before a PUT/PATCH/DELETE). */
  readerOf(entry: CatalogEntry): CatalogEntry | undefined;
}

/** `tool_search` returns at most this many entries. */
export const SEARCH_LIMIT = 8;
/** Added to the score of a route of the section the owner is looking at. */
const PAGE_BOOST = 1.5;

/** Defensive: these never become tools, whatever their annotation says (extra ruling 3). */
const EXCLUDED_PREFIXES = ['/assistant', '/auth'];

const usable = (
  r: RouteContract,
): r is RouteContract & { assistant: { use: 'read' | 'write' } } => {
  const a = r.assistant;
  if (!r.workspaceScoped || !a || (a.use !== 'read' && a.use !== 'write')) return false;
  if (!a.when?.trim()) return false;
  if (EXCLUDED_PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`))) return false;
  // Same rules as the contracts architecture test: a read is a GET or a flagged query POST.
  if (a.use === 'read') return r.method === 'get' || (r.method === 'post' && a.queryPost === true);
  return r.method !== 'get';
};

/** Only workspace-scoped routes marked `read` or `write`; a missing field means unusable. */
export function buildRouteCatalog(routes: readonly RouteContract[]): RouteCatalog {
  const entries: CatalogEntry[] = routes.filter(usable).map((r) => ({
    key: routeKey(r),
    use: r.assistant.use,
    summary: r.summary,
    when: r.assistant.when ?? '',
    method: r.method,
    path: r.path,
    pathParams: [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''),
    ...(r.query ? { query: r.query } : {}),
    ...(r.body ? { body: r.body } : {}),
    ...(r.assistant.use === 'read' && r.assistant.queryPost ? { queryPost: true as const } : {}),
  }));
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return {
    entries,
    get: (key) => byKey.get(key.trim().replace(/^(\w+)\s+/, (m) => m.toUpperCase())),
    readerOf: (entry) => {
      const reader = byKey.get(`GET ${entry.path}`);
      return reader?.use === 'read' ? reader : undefined;
    },
  };
}

/** The catalog of the declared routes, built once. */
export const ROUTE_CATALOG: RouteCatalog = buildRouteCatalog(allRoutes);

/** Words of at least two letters, unaccented and lowercased; a plural `s` is dropped. */
const tokens = (text: string): string[] =>
  foldText(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));

/** `/app/products/123` → `products`; null outside the dashboard. */
function pageSection(pageRoute: string | undefined): string | null {
  const m = /^\/app\/([^/?#]+)/.exec(pageRoute ?? '');
  return m?.[1] ?? null;
}

/**
 * The best entries for `query`: the number of its (unaccented, lowercased) words found in the
 * entry's key, summary and `when`, plus a boost when the route's first path segment is the
 * section of the page the owner is on (`/app/<section>/…`). Entries with no matching word are
 * left out; ties keep the key order, so the result is stable.
 */
export function searchCatalog(
  catalog: RouteCatalog,
  query: string,
  pageRoute?: string,
): CatalogEntry[] {
  const words = [...new Set(tokens(query))];
  if (words.length === 0) return [];
  const section = pageSection(pageRoute);
  return catalog.entries
    .map((e) => {
      const have = new Set(tokens(`${e.key} ${e.summary} ${e.when}`));
      const hits = words.filter((w) => have.has(w)).length;
      const boost = section && e.path.split('/')[1] === section ? PAGE_BOOST : 0;
      return { e, hits, score: hits + boost };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.score - a.score || (a.e.key < b.e.key ? -1 : a.e.key > b.e.key ? 1 : 0))
    .slice(0, SEARCH_LIMIT)
    .map((s) => s.e);
}
