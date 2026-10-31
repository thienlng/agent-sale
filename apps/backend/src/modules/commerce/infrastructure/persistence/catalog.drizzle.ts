import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
  type SQL,
  type TenantTx,
} from '@agent-sales/db';
import { foldVietnamese, type WorkspaceId } from '@agent-sales/shared';

import type {
  CommerceTx,
  StockChange,
  StockRecord,
} from '../../application/ports/commerce-store.js';
import {
  BotNotFoundError,
  DuplicateCodeError,
  ProductNotFoundError,
} from '../../domain/commerce.errors.js';
import {
  bp,
  contains,
  inv,
  n,
  p,
  pgCode,
  toProduct,
  toVariant,
  toWarehouse,
  o,
  v,
  w,
} from './commerce.rows.js';

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
export function catalogTx(
  ws: WorkspaceId,
  tx: TenantTx,
): Pick<CommerceTx, 'warehouses' | 'products' | 'botProducts' | 'inventory'> {
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
      async list({ q, status, selectedFor, offset, limit }) {
        const where = and(
          eq(p.status, status),
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
      async searchForBot({ terms, query, selectedFor, limit }) {
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
        // A 1–2 letter term ("so" of "sơ mi") is too short for trigrams: as a fuzzy prefix it would
        // match every word starting with "s". It counts only as a whole word.
        const termScore = (t: string, against: SQL) =>
          t.length < 3
            ? sql`(case when ${against} ~ ${`\\m${t}\\M`} then 1.0 else 0 end)`
            : sql`word_similarity(${t}, ${against})`;
        const sims = terms.map((t) => termScore(t, text));
        const catSims = terms.map((t) => termScore(t, category));
        const sum = (parts: SQL[]) => sql.join(parts, sql` + `);
        const score = sql`(${sum(sims)}) + 0.5 * (${sum(catSims)}) + (case when strpos(${name}, ${query}) > 0 then 1.0 else 0 end)`;
        const best = sql`greatest(${sql.join([...sims, ...catSims], sql`, `)})`;
        const rows = await tx
          .select()
          .from(p)
          .where(and(base, sql`(${best} >= ${SIMILARITY_FLOOR} or strpos(${name}, ${query}) > 0)`))
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
      async find(id) {
        const [r] = await tx.select().from(p).where(eq(p.id, id)).limit(1);
        return r ? toProduct(r) : null;
      },
      async save(rec) {
        try {
          await tx
            .insert(p)
            .values({ ...rec, workspaceId: ws })
            .onConflictDoUpdate({
              target: p.id,
              set: {
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
          try {
            await tx
              .insert(v)
              .values(row)
              .onConflictDoUpdate({
                target: v.id,
                set: {
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
            if (pgCode(e) === '23505') throw new DuplicateCodeError('sku', rec.sku);
            throw e;
          }
        }
      },
      async archiveVariants(ids) {
        if (ids.length)
          await tx.update(v).set({ archivedAt: new Date() }).where(inArray(v.id, ids));
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
        for (const t of totals.values()) {
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
  };
}
