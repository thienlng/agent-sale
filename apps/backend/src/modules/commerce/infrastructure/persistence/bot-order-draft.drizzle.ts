import { and, asc, eq, inArray, lt, schema, sql, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BotOrderDraftRecord,
  CommerceTx,
  SkuVariantRecord,
} from '../../application/ports/commerce-store.js';
import { p, toVariant, v } from './commerce.rows.js';

const d = schema.botOrderDrafts;

function toDraft(r: typeof d.$inferSelect): BotOrderDraftRecord {
  return {
    conversationId: r.conversationId,
    botId: r.botId,
    channel: r.channel,
    lines: r.lines,
    recipient: r.recipient,
    note: r.note,
    shippingVnd: r.shippingVnd,
    amountsHash: r.amountsHash,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/** Bot order drafts and the SKU lookup, inside one tenant transaction (forced RLS). */
export function botOrdersTx(ws: WorkspaceId, tx: TenantTx): Pick<CommerceTx, 'botOrders'> {
  return {
    botOrders: {
      async variantsBySkus(skus): Promise<SkuVariantRecord[]> {
        const wanted = [...new Set(skus.map((s) => s.trim().toLowerCase()).filter(Boolean))];
        if (!wanted.length) return [];
        const rows = await tx
          .select({ variant: v, productName: p.name, productStatus: p.status })
          .from(v)
          .innerJoin(p, eq(p.id, v.productId))
          .where(inArray(sql`lower(${v.sku})`, wanted))
          // Live variants first: an archived one may share the SKU of the one on sale.
          .orderBy(sql`${v.archivedAt} is not null`, asc(v.position));
        return rows.map((r) => ({
          ...toVariant(r.variant),
          productName: r.productName,
          productActive: r.productStatus === 'active',
        }));
      },
      async findDraft(conversationId, opts) {
        const q = tx.select().from(d).where(eq(d.conversationId, conversationId)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toDraft(r) : null;
      },
      async saveDraft(workspaceId, draft) {
        const row = { ...draft, workspaceId };
        const { conversationId: _c, ...replace } = draft;
        await tx
          .insert(d)
          .values(row)
          .onConflictDoUpdate({ target: [d.workspaceId, d.conversationId], set: replace });
      },
      async deleteDraft(conversationId) {
        const gone = await tx
          .delete(d)
          .where(eq(d.conversationId, conversationId))
          .returning({ id: d.conversationId });
        return gone.length > 0;
      },
      async sweepExpired(now) {
        await tx.delete(d).where(and(eq(d.workspaceId, ws), lt(d.expiresAt, now)));
      },
    },
  };
}
