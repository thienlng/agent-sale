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
  /** The assistant's body: the route's `assistant.body` when it narrows it, else its `body`. */
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
/**
 * Pages whose routes live under other path sections: the inbox shows conversations, and its
 * questions about a bot reply are answered from the bot's turn traces (T-174).
 */
const SECTION_ROUTES: Readonly<Record<string, readonly string[]>> = {
  inbox: ['/conversations', '/bots/{botId}/turns'],
};

/** The page boosts a route of its own section, or a route its section maps to. */
function onPage(entry: CatalogEntry, section: string | null): boolean {
  if (!section) return false;
  if (entry.path.split('/')[1] === section) return true;
  return (SECTION_ROUTES[section] ?? []).some(
    (p) => entry.path === p || entry.path.startsWith(`${p}/`),
  );
}

/**
 * The path sections of an industry's own data. A business looks up short references ("A20",
 * "căn nào có bể bơi") in its own domain first: a hotel's villas and bookings, not the retail
 * catalog (QA Villas #2).
 */
const INDUSTRY_SECTIONS: Readonly<Record<'hotel' | 'saas' | 'shop', readonly string[]>> = {
  hotel: ['/lodging', '/stay-requests'],
  saas: ['/saas-subscriptions', '/saas-plans'],
  shop: ['/products', '/product-variants', '/orders', '/order-settings', '/warehouses'],
};
/** Added to the score of a route of the business's own industry. */
const INDUSTRY_BOOST = 1;
/**
 * Words that mean "the thing the business sells". On a hotel they also match the lodging
 * property routes, so "product A20" finds the villa. A code-like word (`a20`, `p101`) counts too.
 */
const HOTEL_ITEM_WORDS = new Set([
  'product',
  'item',
  'catalog',
  'villa',
  'room',
  'unit',
  'house',
  'homestay',
  'apartment',
  'propertie',
  'property',
  'can',
  'phong',
]);
const CODE_LIKE = /^(?=.*\d)(?=.*[a-z])[a-z0-9]{2,12}$/;

function industryGroupOf(industry: string | undefined): 'hotel' | 'saas' | 'shop' | null {
  if (!industry) return null;
  return industry === 'hotel' ? 'hotel' : industry === 'saas' ? 'saas' : 'shop';
}

const inSections = (entry: { path: string }, sections: readonly string[]): boolean =>
  sections.some((p) => entry.path === p || entry.path.startsWith(`${p}/`));

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
  const entries: CatalogEntry[] = routes.filter(usable).map((r) => {
    const body = r.assistant.body ?? r.body;
    return {
      key: routeKey(r),
      use: r.assistant.use,
      summary: r.summary,
      when: r.assistant.when ?? '',
      method: r.method,
      path: r.path,
      pathParams: [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''),
      ...(r.query ? { query: r.query } : {}),
      ...(body ? { body } : {}),
      ...(r.assistant.use === 'read' && r.assistant.queryPost ? { queryPost: true as const } : {}),
    };
  });
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

/** A non-route entry of the deferred catalog (a native tool, T-171) as search sees it. */
export interface ExtraSearchEntry {
  key: string;
  summary: string;
  when: string;
}

/** A search hit: a route entry, or an extra entry (always a read). */
export type SearchHit = CatalogEntry | (ExtraSearchEntry & { use: 'read' });

/**
 * The best entries for `query`: the number of its (unaccented, lowercased) words found in the
 * entry's key, summary and `when`, plus a boost when the route's first path segment is the
 * section of the page the owner is on (`/app/<section>/…`), or a path that section maps to
 * (`SECTION_ROUTES`), plus a boost for a route of the business's own industry (`INDUSTRY_SECTIONS`;
 * on a hotel an item word or a code-like word also searches the villas). `extra` entries (native
 * tools) are scored with the same words and get no boost. Entries with no matching word are left out;
 * ties keep the key order, so the result is stable.
 */
export function searchCatalog(
  catalog: RouteCatalog,
  query: string,
  pageRoute?: string,
  extra: readonly ExtraSearchEntry[] = [],
  industry?: string,
): SearchHit[] {
  const group = industryGroupOf(industry);
  const asked = [...new Set(tokens(query))];
  // On a hotel, an item word or a bare code also looks for the villas (`/lodging/properties`).
  const words =
    group === 'hotel' && asked.some((w) => HOTEL_ITEM_WORDS.has(w) || CODE_LIKE.test(w))
      ? [...new Set([...asked, 'property', 'propertie'])]
      : asked;
  if (words.length === 0) return [];
  const section = pageSection(pageRoute);
  const own = group ? INDUSTRY_SECTIONS[group] : [];
  const hitsOf = (e: ExtraSearchEntry) => {
    const have = new Set(tokens(`${e.key} ${e.summary} ${e.when}`));
    return words.filter((w) => have.has(w)).length;
  };
  const routes = catalog.entries.map((e) => {
    const hits = hitsOf(e);
    const boost = (onPage(e, section) ? PAGE_BOOST : 0) + (inSections(e, own) ? INDUSTRY_BOOST : 0);
    return { e: e as SearchHit, hits, score: hits + boost };
  });
  const natives = extra.map((x) => {
    const hits = hitsOf(x);
    const e: SearchHit = { key: x.key, summary: x.summary, when: x.when, use: 'read' };
    return { e, hits, score: hits };
  });
  return [...routes, ...natives]
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.score - a.score || (a.e.key < b.e.key ? -1 : a.e.key > b.e.key ? 1 : 0))
    .slice(0, SEARCH_LIMIT)
    .map((s) => s.e);
}
