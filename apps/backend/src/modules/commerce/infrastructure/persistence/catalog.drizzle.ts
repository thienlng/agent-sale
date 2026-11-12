import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  schema,
  sql,
  type SQL,
  type TenantTx,
} from '@agent-sales/db';
import { foldVietnamese, type WorkspaceId } from '@agent-sales/shared';

import { ExternalLinkConflictError } from '../../api/catalog-sync.facade.js';
import type {
  CommerceTx,
  StockChange,
  StockRecord,
} from '../../application/ports/commerce-store.js';
import {
  BotNotFoundError,
  DuplicateCodeError,
  ProductNotDeletableError,
  ProductNotFoundError,
} from '../../domain/commerce.errors.js';
import {
  bp,
  contains,
  inv,
  n,
  oi,
  p,
  pgCode,
  sr,
  toProduct,
  toVariant,
  toWarehouse,
  o,
  v,
  w,
} from './commerce.rows.js';

/** A unique external-link index refused the row: another sync linked it first (retryable). */
function linkRace(e: unknown): void {
  const constraint = (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;
  if (
    pgCode(e) === '23505' &&
    (constraint === 'products_external' || constraint === 'product_variants_external')
  )
    throw new ExternalLinkConflictError(constraint);
}

/** A stated age in folded text: "7 tuoi", "6-7 tuoi", "16+ tuoi", "5t" (T-187). */
const STATED_AGE = '[0-9][[:space:]]*([+][[:space:]]*)?(tuoi|t)([^[:alnum:]]|$)';

/** Drops below this best single-term word_similarity (spec §5). */
const SIMILARITY_FLOOR = 0.3;

const ACCENTED = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
const ACCENTED_ALL = ACCENTED + ACCENTED.toUpperCase();
const UNACCENTED_ALL = [...ACCENTED_ALL].map((c) => foldVietnamese(c)).join('');

/** SQL twin of foldVietnamese for a column: lower-case, no diacritics (đ becomes d). */
function foldedSql(expr: SQL): SQL {
  return sql`translate(lower(${expr}), ${ACCENTED_ALL}, ${UNACCENTED_ALL})`;
}

/** Warehouses, products/variants and inventory inside one tenant transaction. */
/** The values whose lowercase form is in `found`, as the caller spelled them, without repeats. */
function asSent(values: string[], found: Set<string>): string[] {
  const seen = new Set<string>();
  return values.filter((x) => {
    const key = x.toLowerCase();
    if (!found.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function catalogTx(
  ws: WorkspaceId,
  tx: TenantTx,
): Pick<CommerceTx, 'warehouses' | 'products' | 'botProducts' | 'inventory' | 'catalogSync'> {
  /** Inserts selection rows; composite keys reject a bot or product of another workspace. */
  async function insertSelection(workspaceId: WorkspaceId, botId: string, productIds: string[]) {
    try {
      await tx
        .insert(bp)
        .values(productIds.map((productId) => ({ workspaceId, botId, productId })))
        .onConflictDoNothing();
    } catch (e) {
      if (pgCode(e) !== '23503') throw e;
      const constraint = (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;
      if (constraint === 'bot_products_bot_fk') throw new BotNotFoundError(botId);
      throw new ProductNotFoundError(productIds.join(','));
    }
  }
  /** Active, visible-to-bot products; in 'selected' mode only the bot's selection. */
  function botVisible(selectedFor: string | undefined): SQL | undefined {
    return and(
      eq(p.status, 'active'),
      eq(p.visibleToBot, true),
      selectedFor
        ? inArray(p.id, tx.select({ id: bp.productId }).from(bp).where(eq(bp.botId, selectedFor)))
        : undefined,
    );
  }
  return {
    warehouses: {
      async list() {
        const rows = await tx
          .select()
          .from(w)
          .where(isNull(w.deletedAt))
          .orderBy(desc(w.isDefault), asc(w.createdAt));
        return rows.map(toWarehouse);
      },
      async find(id) {
        const [r] = await tx
          .select()
          .from(w)
          .where(and(eq(w.id, id), isNull(w.deletedAt)))
          .limit(1);
        return r ? toWarehouse(r) : null;
      },
      async findDefault() {
        const [r] = await tx
          .select()
          .from(w)
          .where(and(eq(w.isDefault, true), isNull(w.deletedAt)))
          .limit(1);
        return r ? toWarehouse(r) : null;
      },
      async insert(rec) {
        await tx.insert(w).values({ ...rec, workspaceId: ws });
      },
      async update(rec) {
        const { id, ...rest } = rec;
        await tx
          .update(w)
          .set({ ...rest, updatedAt: new Date() })
          .where(eq(w.id, id));
      },
      async clearDefault() {
        await tx.update(w).set({ isDefault: false }).where(eq(w.isDefault, true));
      },
      async softDelete(id) {
        await tx.update(w).set({ deletedAt: new Date() }).where(eq(w.id, id));
      },
      async hasStock(id) {
        const [r] = await tx
          .select({ x: sql`1` })
          .from(inv)
          .where(and(eq(inv.warehouseId, id), sql`(${inv.onHand} <> 0 or ${inv.reserved} <> 0)`))
          .limit(1);
        return Boolean(r);
      },
      async hasOrders(id) {
        const [r] = await tx
          .select({ x: sql`1` })
          .from(o)
          .where(eq(o.warehouseId, id))
          .limit(1);
        return Boolean(r);
      },
    },

    products: {
      async matchCodes(codes, skus) {
        const lowerCodes = [...new Set(codes.map((c) => c.toLowerCase()))];
        const lowerSkus = [...new Set(skus.map((x) => x.toLowerCase()))];
        const [codeRows, skuRows] = await Promise.all([
          lowerCodes.length
            ? tx
                .selectDistinct({ k: sql<string>`lower(${p.code})` })
                .from(p)
                .where(inArray(sql`lower(${p.code})`, lowerCodes))
            : [],
          lowerSkus.length
            ? tx
                .selectDistinct({ k: sql<string>`lower(${v.sku})` })
                .from(v)
                .where(and(isNull(v.archivedAt), inArray(sql`lower(${v.sku})`, lowerSkus)))
            : [],
        ]);
        return {
          codes: asSent(codes, new Set(codeRows.map((r) => r.k))),
          skus: asSent(skus, new Set(skuRows.map((r) => r.k))),
        };
      },
      async list({ q, status, selectedFor, source, offset, limit }) {
        const where = and(
          eq(p.status, status),
          source === 'rapiz'
            ? isNull(p.externalSource)
            : source
              ? eq(p.externalSource, source)
              : undefined,
          q ? contains(p.searchText, q) : undefined,
          selectedFor
            ? inArray(
                p.id,
                tx.select({ id: bp.productId }).from(bp).where(eq(bp.botId, selectedFor)),
              )
            : undefined,
        );
        const [rows, [count]] = await Promise.all([
          tx.select().from(p).where(where).orderBy(desc(p.updatedAt)).offset(offset).limit(limit),
          tx
            .select({ c: sql<number>`count(*)` })
            .from(p)
            .where(where),
        ]);
        return { rows: rows.map(toProduct), total: n(count?.c) };
      },
      async searchForBot({ terms, query, selectedFor, withStatedAges, limit }) {
        const base = botVisible(selectedFor);
        if (!terms.length) {
          const rows = await tx
            .select()
            .from(p)
            .where(base)
            .orderBy(asc(p.name), asc(p.id))
            .limit(limit);
          return rows.map(toProduct);
        }
        const category = foldedSql(sql`coalesce(${p.category}, '')`);
        const name = foldedSql(sql`${p.name}`);
        const text = sql`${p.searchText}`;
        // The description and a course's or service's audience and level are searched too, at the
        // category's weight (T-187): "khoá cho bé 6-7 tuổi" lives there more often than in a name.
        const details = foldedSql(
          sql`coalesce(${p.description}, '') || ' ' || coalesce(${p.offering}->>'audience', '') || ' ' || coalesce(${p.offering}->>'level', '')`,
        );
        // A 1–2 letter term ("so" of "sơ mi") is too short for trigrams: as a fuzzy prefix it would
        // match every word starting with "s". It counts only as a whole word.
        const termScore = (t: string, against: SQL) =>
          t.length < 3
            ? sql`(case when ${against} ~ ${`\\m${t}\\M`} then 1.0 else 0 end)`
            : sql`word_similarity(${t}, ${against})`;
        const sims = terms.map((t) => termScore(t, text));
        const catSims = terms.map((t) => termScore(t, category));
        const detailSims = terms.map((t) => termScore(t, details));
        const sum = (parts: SQL[]) => sql.join(parts, sql` + `);
        const score = sql`(${sum(sims)}) + 0.5 * (${sum(catSims)}) + 0.5 * (${sum(detailSims)}) + (case when strpos(${name}, ${query}) > 0 then 1.0 else 0 end)`;
        const best = sql`greatest(${sql.join([...sims, ...catSims, ...detailSims], sql`, `)})`;
        // The caller ranks these by the age the query names (the age itself is no trigram term).
        const statesAge = withStatedAges
          ? sql` or (${name} || ' ' || ${details}) ~ ${STATED_AGE}`
          : sql``;
        const rows = await tx
          .select()
          .from(p)
          .where(
            and(
              base,
              sql`(${best} >= ${SIMILARITY_FLOOR} or strpos(${name}, ${query}) > 0${statesAge})`,
            ),
          )
          .orderBy(desc(score), asc(p.name), asc(p.id))
          .limit(limit);
        return rows.map(toProduct);
      },
      async findForBot(ids, selectedFor) {
        if (!ids.length) return [];
        const rows = await tx
          .select()
          .from(p)
          .where(and(botVisible(selectedFor), inArray(p.id, ids)));
        return rows.map(toProduct);
      },
      async countForBot(selectedFor) {
        const [count] = await tx
          .select({ c: sql<number>`count(*)` })
          .from(p)
          .where(botVisible(selectedFor));
        return n(count?.c);
      },
      async find(id, opts) {
        const q = tx.select().from(p).where(eq(p.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toProduct(r) : null;
      },
      async save(rec) {
        // Undefined keeps the stored link; source and id are always written together.
        const { external, offering: kind, ...fields } = rec;
        const link =
          external === undefined
            ? {}
            : { externalSource: external?.source ?? null, externalId: external?.id ?? null };
        // Undefined keeps the stored course or service details (a PMS sync never sends them).
        const offering = kind === undefined ? {} : { offering: kind };
        try {
          await tx
            .insert(p)
            .values({ ...fields, ...link, ...offering, workspaceId: ws })
            .onConflictDoUpdate({
              target: p.id,
              set: {
                ...link,
                ...offering,
                code: rec.code,
                name: rec.name,
                description: rec.description,
                category: rec.category,
                status: rec.status,
                visibleToBot: rec.visibleToBot,
                botInstructions: rec.botInstructions,
                imageUrls: rec.imageUrls,
                accommodation: rec.accommodation ?? null,
                searchText: rec.searchText,
                updatedAt: rec.updatedAt,
              },
            });
        } catch (e) {
          linkRace(e);
          if (pgCode(e) === '23505') throw new DuplicateCodeError('code', rec.code);
          throw e;
        }
      },
      async variantsOf(productIds) {
        if (!productIds.length) return [];
        const rows = await tx
          .select()
          .from(v)
          .where(inArray(v.productId, productIds))
          .orderBy(asc(v.position));
        return rows.map(toVariant);
      },
      async saveVariants(workspaceId, variants) {
        for (const rec of variants) {
          const row = {
            id: rec.id,
            workspaceId,
            productId: rec.productId,
            sku: rec.sku,
            name: rec.name,
            price: rec.price,
            cost: rec.cost,
            weightGram: rec.weightGram,
            position: rec.position,
            archivedAt: null,
            updatedAt: new Date(),
          };
          // Undefined keeps the stored external id; null clears it.
          const link = rec.externalId === undefined ? {} : { externalId: rec.externalId };
          try {
            await tx
              .insert(v)
              .values({ ...row, ...link })
              .onConflictDoUpdate({
                target: v.id,
                set: {
                  ...link,
                  sku: row.sku,
                  name: row.name,
                  price: row.price,
                  cost: row.cost,
                  weightGram: row.weightGram,
                  position: row.position,
                  archivedAt: null,
                  updatedAt: row.updatedAt,
                },
              });
          } catch (e) {
            linkRace(e);
            if (pgCode(e) === '23505') throw new DuplicateCodeError('sku', rec.sku);
            throw e;
          }
        }
      },
      async archiveVariants(ids) {
        if (ids.length)
          await tx.update(v).set({ archivedAt: new Date() }).where(inArray(v.id, ids));
      },
      async usedByOrders(productId) {
        const [line] = await tx
          .select({ x: sql`1` })
          .from(oi)
          .innerJoin(v, and(eq(v.workspaceId, oi.workspaceId), eq(v.id, oi.variantId)))
          .where(and(eq(oi.workspaceId, ws), eq(v.productId, productId)))
          .limit(1);
        if (line) return true;
        const [stay] = await tx
          .select({ x: sql`1` })
          .from(sr)
          .where(and(eq(sr.workspaceId, ws), eq(sr.propertyId, productId)))
          .limit(1);
        return Boolean(stay);
      },
      async remove(productId) {
        try {
          await tx.delete(p).where(and(eq(p.workspaceId, ws), eq(p.id, productId)));
        } catch (e) {
          if (pgCode(e) === '23503') throw new ProductNotDeletableError('product_in_orders');
          throw e;
        }
      },
      async variantsByIds(ids) {
        if (!ids.length) return [];
        const rows = await tx
          .select({ variant: v, productName: p.name, productCode: p.code, productStatus: p.status })
          .from(v)
          .innerJoin(p, eq(p.id, v.productId))
          .where(and(inArray(v.id, ids), isNull(p.accommodation)));
        return rows.map((r) => ({
          ...toVariant(r.variant),
          productName: r.productName,
          productCode: r.productCode,
          productActive: r.productStatus === 'active',
        }));
      },
      async searchVariants({ q, warehouseId, inStock, limit }) {
        const available = sql<number>`coalesce(${inv.onHand}, 0) - coalesce(${inv.reserved}, 0)`;
        const rows = await tx
          .select({
            variant: v,
            productName: p.name,
            productCode: p.code,
            onHand: sql<number>`coalesce(${inv.onHand}, 0)`,
            reserved: sql<number>`coalesce(${inv.reserved}, 0)`,
          })
          .from(v)
          .innerJoin(p, eq(p.id, v.productId))
          .leftJoin(inv, and(eq(inv.variantId, v.id), eq(inv.warehouseId, warehouseId)))
          .where(
            and(
              isNull(v.archivedAt),
              eq(p.status, 'active'),
              isNull(p.accommodation),
              q ? contains(p.searchText, q) : undefined,
              inStock ? sql`${available} > 0` : undefined,
            ),
          )
          .orderBy(asc(p.name), asc(v.position))
          .limit(limit);
        return rows.map((r) => ({
          ...toVariant(r.variant),
          productName: r.productName,
          productCode: r.productCode,
          onHand: n(r.onHand),
          reserved: n(r.reserved),
        }));
      },
    },

    botProducts: {
      async list(botId) {
        const rows = await tx
          .select({ id: bp.productId })
          .from(bp)
          .where(eq(bp.botId, botId))
          .orderBy(asc(bp.createdAt), asc(bp.productId));
        return rows.map((r) => r.id);
      },
      async replace(workspaceId, botId, productIds) {
        // Two saves of one bot's selection would both delete, then both insert the same rows
        // (duplicate key): one bot's saves run one after the other.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`bot-products/${workspaceId}/${botId}`},0))`,
        );
        await tx.delete(bp).where(eq(bp.botId, botId));
        if (productIds.length) await insertSelection(workspaceId, botId, productIds);
      },
      async add(workspaceId, botId, productId) {
        await insertSelection(workspaceId, botId, [productId]);
      },
    },

    inventory: {
      async lockStock(variantId, warehouseId) {
        const [r] = await tx
          .select()
          .from(inv)
          .where(and(eq(inv.variantId, variantId), eq(inv.warehouseId, warehouseId)))
          .for('update');
        return r
          ? {
              variantId: r.variantId,
              warehouseId: r.warehouseId,
              onHand: r.onHand,
              reserved: r.reserved,
            }
          : null;
      },
      async stockOf(variantIds) {
        if (!variantIds.length) return [];
        const rows = await tx.select().from(inv).where(inArray(inv.variantId, variantIds));
        return rows.map((r): StockRecord => ({
          variantId: r.variantId,
          warehouseId: r.warehouseId,
          onHand: r.onHand,
          reserved: r.reserved,
        }));
      },
      async lowStock({ threshold, limit }) {
        // RLS (withTenant) limits every table to the workspace; the filter is explicit too.
        const rows = await tx.execute<{
          product_id: string;
          variant_id: string;
          product_name: string;
          variant_name: string;
          sku: string;
          available: number;
          total: number;
        }>(sql`
          with low as (
            select p.id as product_id, v.id as variant_id, p.name as product_name,
                   v.name as variant_name, v.sku,
                   sum(i.on_hand - i.reserved)::int as available
            from ${v} v
            join ${p} p on p.id = v.product_id
            join ${inv} i on i.variant_id = v.id
            where v.workspace_id = ${ws} and p.status = 'active' and v.archived_at is null
              -- A course or a service has no stock to run low (T-187).
              and p.offering is null
            group by p.id, v.id
            having sum(i.on_hand - i.reserved) <= ${threshold})
          select low.*, count(*) over ()::int as total from low
          order by available, product_name, variant_name, variant_id
          limit ${Math.max(1, limit)}`);
        const list = [...rows];
        return {
          count: limit > 0 ? Number(list[0]?.total ?? 0) : 0,
          items: (limit > 0 ? list : []).map((r) => ({
            productId: r.product_id,
            variantId: r.variant_id,
            name: r.variant_name ? `${r.product_name} - ${r.variant_name}` : r.product_name,
            sku: r.sku || null,
            available: Number(r.available),
          })),
        };
      },
      async ensureRow(workspaceId, variantId, warehouseId) {
        await tx
          .insert(inv)
          .values({ workspaceId, variantId, warehouseId, onHand: 0, reserved: 0 })
          .onConflictDoNothing({ target: [inv.variantId, inv.warehouseId] });
      },
      async apply(workspaceId, changes: StockChange[]) {
        if (!changes.length) return;
        // One upsert per (variant, warehouse) with the summed deltas, one movement per change.
        const totals = new Map<
          string,
          { variantId: string; warehouseId: string; onHand: number; reserved: number }
        >();
        for (const c of changes) {
          const key = `${c.variantId}:${c.warehouseId}`;
          const t = totals.get(key) ?? {
            variantId: c.variantId,
            warehouseId: c.warehouseId,
            onHand: 0,
            reserved: 0,
          };
          t.onHand += c.onHandDelta;
          t.reserved += c.reservedDelta;
          totals.set(key, t);
        }
        // Rows in one fixed order, so two transactions moving the same rows cannot deadlock.
        const ordered = [...totals.values()].sort((a, b) =>
          `${a.variantId}:${a.warehouseId}`.localeCompare(`${b.variantId}:${b.warehouseId}`),
        );
        for (const t of ordered) {
          await tx
            .insert(inv)
            .values({
              workspaceId,
              variantId: t.variantId,
              warehouseId: t.warehouseId,
              onHand: t.onHand,
              // Postgres checks CHECK constraints on the proposed insert row even when the
              // conflict branch runs, so this value must be valid; the update below is not clamped.
              reserved: Math.max(t.reserved, 0),
            })
            .onConflictDoUpdate({
              target: [inv.variantId, inv.warehouseId],
              set: {
                onHand: sql`${inv.onHand} + ${t.onHand}`,
                // No clamping: order rows are locked while stock moves, so a negative hold
                // can only be a bug, and the CHECK constraint should make it fail loudly.
                reserved: sql`${inv.reserved} + ${t.reserved}`,
                updatedAt: new Date(),
              },
            });
        }
        await tx.insert(schema.inventoryMovements).values(
          changes.map((c) => ({
            id: crypto.randomUUID(),
            workspaceId,
            variantId: c.variantId,
            warehouseId: c.warehouseId,
            onHandDelta: c.onHandDelta,
            reservedDelta: c.reservedDelta,
            reason: c.reason,
            refType: c.refType,
            refId: c.refId,
            actorUserId: c.actorUserId,
          })),
        );
      },
    },

    catalogSync: {
      async lockExternal(source, externalId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`catalog-sync/${ws}/${source}/${externalId}`},0))`,
        );
      },
      async findProduct(source, externalId, opts) {
        const q = tx
          .select()
          .from(p)
          .where(and(eq(p.externalSource, source), eq(p.externalId, externalId)))
          .limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toProduct(r) : null;
      },
      async variantsByExternalIds(externalIds) {
        if (!externalIds.length) return [];
        const rows = await tx
          .select({ variant: v, productSource: p.externalSource })
          .from(v)
          .innerJoin(p, eq(p.id, v.productId))
          .where(inArray(v.externalId, externalIds));
        return rows.map((r) => ({ ...toVariant(r.variant), productSource: r.productSource }));
      },
      async archiveAndUnlinkVariants(ids) {
        if (!ids.length) return;
        await tx
          .update(v)
          .set({ archivedAt: sql`coalesce(${v.archivedAt}, now())`, externalId: null })
          .where(inArray(v.id, ids));
      },
      async codeTaken(code) {
        const [r] = await tx
          .select({ x: sql`1` })
          .from(p)
          .where(sql`lower(${p.code}) = lower(${code})`)
          .limit(1);
        return Boolean(r);
      },
      async archiveProducts(source, externalIds) {
        if (!externalIds.length) return 0;
        const rows = await tx
          .update(p)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(
            and(
              eq(p.externalSource, source),
              inArray(p.externalId, externalIds),
              eq(p.status, 'active'),
            ),
          )
          .returning({ id: p.id });
        return rows.length;
      },
      async archiveLinkedVariants(source, externalIds) {
        if (!externalIds.length) return 0;
        const linked = tx.select({ id: p.id }).from(p).where(eq(p.externalSource, source));
        const rows = await tx
          .update(v)
          .set({ archivedAt: sql`now()`, updatedAt: new Date() })
          .where(
            and(
              inArray(v.externalId, externalIds),
              isNull(v.archivedAt),
              inArray(v.productId, linked),
            ),
          )
          .returning({ id: v.id });
        return rows.length;
      },
      async archiveUnlinkedVariants(source) {
        const linked = tx.select({ id: p.id }).from(p).where(eq(p.externalSource, source));
        const rows = await tx
          .update(v)
          .set({ archivedAt: sql`now()`, updatedAt: new Date() })
          .where(and(isNull(v.externalId), isNull(v.archivedAt), inArray(v.productId, linked)))
          .returning({ id: v.id });
        return rows.length;
      },
      async linkedIds(source) {
        const products = await tx
          .select({ id: p.externalId })
          .from(p)
          .where(and(eq(p.externalSource, source), eq(p.status, 'active')));
        const variants = await tx
          .select({ id: v.externalId })
          .from(v)
          .innerJoin(p, eq(p.id, v.productId))
          .where(and(eq(p.externalSource, source), isNull(v.archivedAt), isNotNull(v.externalId)));
        const ids = (rows: Array<{ id: string | null }>) =>
          rows.map((r) => r.id).filter((id): id is string => id !== null);
        return { products: ids(products), variants: ids(variants) };
      },
      async release(source) {
        const linked = tx.select({ id: p.id }).from(p).where(eq(p.externalSource, source));
        await tx
          .update(v)
          .set({ externalId: null, updatedAt: new Date() })
          .where(and(isNotNull(v.externalId), inArray(v.productId, linked)));
        const rows = await tx
          .update(p)
          .set({ externalSource: null, externalId: null, updatedAt: new Date() })
          .where(eq(p.externalSource, source))
          .returning({ id: p.id });
        return rows.length;
      },
      async count(source) {
        const [c] = await tx
          .select({ c: sql<number>`count(*)` })
          .from(p)
          .where(eq(p.externalSource, source));
        return n(c?.c);
      },
      async previewMatch(lowerCodes) {
        const live = and(
          isNull(v.archivedAt),
          lowerCodes.length ? inArray(sql`lower(${v.sku})`, lowerCodes) : sql`false`,
        );
        const [matched] = await tx
          .select({ c: sql<number>`count(distinct lower(${v.sku}))` })
          .from(v)
          .where(live);
        const [rapizOnly] = await tx
          .select({ c: sql<number>`count(*)` })
          .from(p)
          .where(
            and(
              eq(p.status, 'active'),
              isNull(p.externalSource),
              sql`not exists (select 1 from ${v} where ${v.productId} = ${p.id} and ${live})`,
            ),
          );
        return { matched: n(matched?.c), rapizOnly: n(rapizOnly?.c) };
      },
    },
  };
}
