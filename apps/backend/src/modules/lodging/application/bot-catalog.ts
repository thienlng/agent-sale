import type { ProductDto } from '@agent-sales/contracts';
import { foldVietnamese, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { LodgingBotScope, LodgingCatalogFacade } from '../api/lodging.facade.js';
import { LodgingUnavailableError } from '../domain/lodging.errors.js';
import { localToday } from '../domain/nights.js';
import { toBotProduct } from './bot-product.js';
import { LODGING_STORE, type LodgingStore, type LodgingTx } from './ports/lodging-store.js';

const MAX_ROWS = 300;
const MAX_IDS = 10;
const MAX_TERMS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Folded (accent-free, lower case), punctuation-free text. */
const fold = (text: string): string =>
  foldVietnamese(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Distinct folded query words of at least two characters (max 8). */
function terms(query: string): string[] {
  return [...new Set(fold(query).split(' '))].filter((w) => w.length >= 2).slice(0, MAX_TERMS);
}

/** What a query is matched against: code, name, area and amenities. */
function haystack(p: ProductDto): string {
  return ` ${fold([p.code, p.name, p.category ?? '', ...(p.accommodation?.amenities ?? [])].join(' '))} `;
}

/**
 * Words found count once each; the whole query found as a phrase counts one more. A product with
 * no word found does not match.
 */
function score(p: ProductDto, words: string[], phrase: string): number {
  const text = haystack(p);
  const hits = words.filter((w) => text.includes(w)).length;
  return hits === 0 ? 0 : hits + (phrase && text.includes(phrase) ? 1 : 0);
}

/**
 * The bot catalog of a hotel business, read from lodging properties (`LODGING_CATALOG_FACADE`).
 * The bot's selection lives in `lodging_bot_properties` (no rows = every active property); a
 * paused property is never offered. Without a database every read answers empty, as the commerce
 * catalog does.
 */
@Injectable()
export class LodgingBotCatalog implements LodgingCatalogFacade {
  constructor(@Inject(LODGING_STORE) private readonly store: LodgingStore) {}

  async searchBotCatalog(
    ws: WorkspaceId,
    bot: LodgingBotScope,
    input: { query?: string; maxPriceVnd?: number; inStockOnly?: boolean; limit: number },
  ): Promise<ProductDto[]> {
    const limit = Math.max(1, Math.min(input.limit, MAX_ROWS));
    const words = terms(input.query ?? '');
    // A query with no usable word ("a", "?!") matches nothing; only a missing query browses.
    if (!words.length && (input.query ?? '').trim()) return [];
    const rows = (await this.#offered(ws, bot)).filter(
      (p) => input.maxPriceVnd === undefined || p.priceMin <= input.maxPriceVnd,
    );
    if (!words.length) return rows.slice(0, limit);
    const phrase = words.length > 1 ? fold(input.query ?? '') : '';
    return rows
      .map((p, index) => ({ p, index, s: score(p, words, phrase) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.index - b.index)
      .slice(0, limit)
      .map((x) => x.p);
  }

  async getBotProductsByIds(
    ws: WorkspaceId,
    bot: LodgingBotScope,
    ids: readonly string[],
  ): Promise<ProductDto[]> {
    const wanted = [...new Set(ids)].filter((id) => UUID.test(id)).slice(0, MAX_IDS);
    if (!wanted.length) return [];
    const byId = new Map((await this.#offered(ws, bot, wanted)).map((p) => [p.id, p]));
    return wanted.flatMap((id) => byId.get(id) ?? []);
  }

  async countBotCatalog(ws: WorkspaceId, bot: LodgingBotScope): Promise<number> {
    return (await this.#offered(ws, bot)).length;
  }

  /** The bot's active, fully priced properties (optionally only `ids`), in the owner's order. */
  async #offered(ws: WorkspaceId, bot: LodgingBotScope, ids?: string[]): Promise<ProductDto[]> {
    try {
      return await this.store.run(ws, (tx) => this.#products(tx, bot.botId, ids));
    } catch (error) {
      if (error instanceof LodgingUnavailableError) return [];
      throw error;
    }
  }

  async #products(tx: LodgingTx, botId: string, ids?: string[]): Promise<ProductDto[]> {
    const selected = await tx.botPropertyIds(botId);
    const scope = selected && ids ? ids.filter((id) => selected.includes(id)) : (selected ?? ids);
    const properties = await tx.properties({
      ...(scope ? { ids: scope } : {}),
      activeOnly: true,
    });
    if (!properties.length) return [];
    const pids = properties.map((p) => p.id);
    const units = await tx.units(pids);
    const ratesOf = await tx.ratesByProperty(pids);
    const packages = await tx.packages(pids);
    const today = localToday(new Date());
    const products: ProductDto[] = [];
    for (const p of properties) {
      const own = packages.filter((pk) => pk.propertyId === p.id);
      const dto = toBotProduct(p, units, ratesOf.get(p.id) ?? [], today, own);
      if (dto) products.push(dto);
    }
    return products;
  }
}
