import { createHash } from 'node:crypto';

import {
  computeAmounts,
  isUuid,
  newId,
  normalizeVnPhone,
  type WorkspaceId,
} from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import type {
  BotOrderItemInput,
  BotOrderProblem,
  BotOrderRecipient,
  ConfirmBotOrderResult,
  PrepareBotOrderResult,
} from '../api/commerce.facade.js';
import {
  amountsFingerprint,
  BOT_ORDER_DRAFT_TTL_MS,
  BOT_ORDER_HISTORY_NOTE,
  botOrderRequestId,
  checkRecipient,
  cleanNote,
  mergeItems,
  orderSourceOf,
} from '../domain/bot-order.js';
import {
  CommerceUnavailableError,
  DuplicateOrderRequestError,
  VariantNotFoundError,
} from '../domain/commerce.errors.js';
import { stockTransition } from '../domain/order-stock.js';
import { buildOrderSummary } from '../domain/order-summary.js';
import { orderLines } from './order-rules.js';
import { amountFields, orderSearchText, stockChanges } from './order.mappers.js';
import {
  type BotOrderDraftRecord,
  COMMERCE_STORE,
  type CommerceStore,
  type CommerceTx,
  type OrderRecord,
  type SkuVariantRecord,
} from './ports/commerce-store.js';

const log = new Logger('BotOrderService');
const LEAD_SOURCES: ReadonlySet<string> = new Set(['facebook', 'instagram', 'website']);

type PrepareInput = {
  botId: string;
  conversationId: string;
  channel: string;
  items: BotOrderItemInput[];
  recipient: BotOrderRecipient;
  note?: string;
  shippingFeeVnd: number | null;
};
type Confirmed = { result: ConfirmBotOrderResult; lead: BotOrderDraftRecord | null };

const hashOf = (fingerprint: string) =>
  createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);

function amountsOf(
  lines: ReadonlyArray<{ qty: number; unitPrice: number; unitCost: number }>,
  shipping: number | null,
) {
  return computeAmounts({
    items: lines,
    discountType: 'amount',
    discountValue: 0,
    shippingFee: shipping ?? 0,
    shippingFeeCharged: shipping ?? 0,
    freeShipping: false,
    surcharge: 0,
    transferAmount: 0,
  });
}

/**
 * Orders the bot takes in chat (spec §4, ADR-016): the bot prepares a draft from catalog SKUs,
 * the customer confirms it, and the order is created pending staff review (OrderReviewService).
 */
@Injectable()
export class BotOrderService {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}

  async prepareBotOrder(ws: WorkspaceId, input: PrepareInput): Promise<PrepareBotOrderResult> {
    if (!isUuid(input.conversationId)) throw new TypeError('conversationId must be a uuid');
    const { recipient, problems: recipientProblems } = checkRecipient(input.recipient);
    const note = cleanNote(input.note);
    const items = mergeItems(input.items);
    const fee =
      Number.isSafeInteger(input.shippingFeeVnd) && (input.shippingFeeVnd ?? -1) >= 0
        ? input.shippingFeeVnd
        : null;
    // Throws NOT_FOUND for a bot of another workspace; its catalog mode scopes the SKUs.
    const bot = await this.bots.getBot(ws, input.botId);
    const selectedFor = bot.catalogMode === 'selected' ? bot.id : undefined;

    return this.store.run(ws, async (tx) => {
      const now = new Date();
      await tx.botOrders.sweepExpired(now);
      const bySku = new Map<string, SkuVariantRecord>();
      for (const v of await tx.botOrders.variantsBySkus(items.map((i) => i.sku))) {
        if (!bySku.has(v.sku.toLowerCase())) bySku.set(v.sku.toLowerCase(), v);
      }
      const candidates = [...new Set([...bySku.values()].map((v) => v.productId))];
      const inScope = new Set(
        (candidates.length ? await tx.products.findForBot(candidates, selectedFor) : []).map(
          (p) => p.id,
        ),
      );
      const warehouse = await tx.warehouses.findDefault();
      const stock = warehouse
        ? await tx.inventory.stockOf([...bySku.values()].map((v) => v.id))
        : [];
      const available = (variantId: string) => {
        const row = stock.find((s) => s.variantId === variantId && s.warehouseId === warehouse?.id);
        return row ? row.onHand - row.reserved : 0;
      };

      const problems: BotOrderProblem[] = items.length ? [] : [{ code: 'unknown_sku' }];
      const lines: Array<{ variant: SkuVariantRecord; qty: number }> = [];
      for (const item of items) {
        const v = bySku.get(item.sku.toLowerCase());
        if (!v) problems.push({ code: 'unknown_sku', sku: item.sku });
        else if (v.archived || !v.productActive) problems.push({ code: 'inactive', sku: item.sku });
        // Products the bot may not sell are not revealed as such.
        else if (!inScope.has(v.productId)) problems.push({ code: 'unknown_sku', sku: item.sku });
        else if (available(v.id) < item.qty)
          problems.push({
            code: 'insufficient_stock',
            sku: item.sku,
            available: Math.max(available(v.id), 0),
          });
        else lines.push({ variant: v, qty: item.qty });
      }
      problems.push(...recipientProblems.map((code) => ({ code })));
      if (problems.length || !recipient) return { ok: false, problems };

      const priced = lines.map((l) => ({
        variantId: l.variant.id,
        qty: l.qty,
        unitPrice: l.variant.price,
        unitCost: l.variant.cost,
      }));
      const amounts = amountsOf(priced, fee);
      const person = { name: recipient.name, phone: recipient.phone, address: recipient.address };
      await tx.botOrders.saveDraft(ws, {
        conversationId: input.conversationId,
        botId: bot.id,
        channel: input.channel,
        lines: lines.map((l) => ({ variantId: l.variant.id, sku: l.variant.sku, qty: l.qty })),
        recipient: person,
        note,
        shippingVnd: fee,
        amountsHash: hashOf(
          amountsFingerprint({ lines: priced, shippingFee: fee, recipient: person, note }),
        ),
        createdAt: now,
        expiresAt: new Date(now.getTime() + BOT_ORDER_DRAFT_TTL_MS),
      });
      return {
        ok: true,
        summaryText: buildOrderSummary({
          lines: lines.map((l) => ({
            productName: l.variant.productName,
            variantName: l.variant.name,
            qty: l.qty,
            lineTotal: l.variant.price * l.qty,
          })),
          shippingFee: fee,
          total: amounts.total,
          recipient: person,
          note,
        }),
        productIds: [...new Set(lines.map((l) => l.variant.productId))],
      };
    });
  }

  async confirmBotOrder(
    ws: WorkspaceId,
    input: { botId: string; botName: string; conversationId: string },
  ): Promise<ConfirmBotOrderResult> {
    if (!isUuid(input.conversationId)) return { ok: false, code: 'nothing_pending' };
    let done: Confirmed;
    try {
      done = await this.store.run(ws, (tx) => this.#confirm(ws, tx, input));
    } catch (error) {
      // Two confirmations of the same draft raced past the lookup: the loser returns the winner's order.
      if (!(error instanceof DuplicateOrderRequestError)) throw error;
      const existing = await this.store.run(ws, async (tx) => {
        const draft = await tx.botOrders.findDraft(input.conversationId);
        if (!draft) return null;
        await tx.botOrders.deleteDraft(input.conversationId);
        return tx.orders.findByRequestId(
          botOrderRequestId(input.conversationId, draft.amountsHash),
        );
      });
      if (!existing) throw error;
      return { ok: true, orderId: existing.id, orderCode: existing.code };
    }
    if (done.lead) await this.#upsertLead(ws, done.lead);
    return done.result;
  }

  async #confirm(
    ws: WorkspaceId,
    tx: CommerceTx,
    input: { botId: string; botName: string; conversationId: string },
  ): Promise<Confirmed> {
    const now = new Date();
    const fail = async (code: 'expired' | 'insufficient_stock'): Promise<Confirmed> => {
      // A draft that can no longer become the order it showed is dropped; the bot prepares again.
      await tx.botOrders.deleteDraft(input.conversationId);
      return { result: { ok: false, code }, lead: null };
    };
    // Locked: a second confirmation waits, then finds the draft gone.
    const draft = await tx.botOrders.findDraft(input.conversationId, { forUpdate: true });
    if (!draft || draft.botId !== input.botId) {
      return { result: { ok: false, code: 'nothing_pending' }, lead: null };
    }
    if (draft.expiresAt <= now) return fail('expired');
    const requestId = botOrderRequestId(input.conversationId, draft.amountsHash);
    const existing = await tx.orders.findByRequestId(requestId);
    if (existing) {
      await tx.botOrders.deleteDraft(input.conversationId);
      return { result: { ok: true, orderId: existing.id, orderCode: existing.code }, lead: null };
    }
    const warehouse = await tx.warehouses.findDefault();
    if (!warehouse) return fail('insufficient_stock');
    let items;
    try {
      items = await orderLines(
        tx,
        draft.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      );
    } catch (error) {
      // Archived since the summary: it cannot be ordered any more.
      if (error instanceof VariantNotFoundError) return fail('insufficient_stock');
      throw error;
    }
    const fingerprint = amountsFingerprint({
      lines: items,
      shippingFee: draft.shippingVnd,
      recipient: draft.recipient,
      note: draft.note,
    });
    // A price changed since the customer saw the summary: they must see the new one first.
    if (hashOf(fingerprint) !== draft.amountsHash) return fail('expired');
    for (const item of items) {
      const row = await tx.inventory.lockStock(item.variantId, warehouse.id);
      if (!row || row.onHand - row.reserved < item.qty) return fail('insufficient_stock');
    }

    const amounts = amountsOf(items, draft.shippingVnd);
    const stock = stockTransition('released', 'new');
    const order: OrderRecord = {
      id: newId(),
      code: await tx.orders.nextCode(ws),
      status: 'new',
      stockState: stock.next,
      source: orderSourceOf(draft.channel),
      warehouseId: warehouse.id,
      customer: { name: draft.recipient.name, phone: draft.recipient.phone },
      recipient: { ...draft.recipient },
      expectedDeliveryAt: null,
      ...amountFields(amounts),
      carrier: null,
      trackingCode: null,
      noteInternal: draft.note ?? '',
      notePrint: '',
      createdByUserId: null,
      createdByName: input.botName,
      clientRequestId: requestId,
      createdByKind: 'bot',
      conversationId: input.conversationId,
      reviewState: 'pending',
      reviewedByUserId: null,
      reviewedByName: null,
      reviewedAt: null,
      placedAt: now,
      confirmedAt: null,
      cancelledAt: null,
      searchText: '',
      createdAt: now,
      updatedAt: now,
    };
    order.searchText = orderSearchText(order);
    await tx.orders.insert(order, items);
    await tx.inventory.apply(ws, stockChanges(stock.actions, order, items, null));
    await tx.orders.addHistory(ws, order.id, {
      fromStatus: null,
      toStatus: 'new',
      note: BOT_ORDER_HISTORY_NOTE,
      actorUserId: null,
      actorName: input.botName,
      createdAt: now,
    });
    await tx.botOrders.deleteDraft(input.conversationId);
    return { result: { ok: true, orderId: order.id, orderCode: order.code }, lead: draft };
  }

  /** Best effort: the order exists either way. The CRM keeps name and phone (it takes no address). */
  async #upsertLead(ws: WorkspaceId, draft: BotOrderDraftRecord): Promise<void> {
    const phoneE164 = normalizeVnPhone(draft.recipient.phone);
    if (!phoneE164 || !LEAD_SOURCES.has(draft.channel)) return;
    try {
      await this.crm.upsertLeadByPhone(ws, {
        phoneE164,
        sourceKey: draft.channel as 'facebook' | 'instagram' | 'website',
        displayName: draft.recipient.name,
        firstUrl: null,
      });
    } catch (error) {
      log.warn(`bot order lead upsert failed: ${(error as Error).constructor.name}`);
    }
  }

  async cancelBotOrderDraft(ws: WorkspaceId, conversationId: string): Promise<boolean> {
    if (!isUuid(conversationId)) return false;
    try {
      return await this.store.run(ws, async (tx) => {
        const draft = await tx.botOrders.findDraft(conversationId);
        if (!draft) return false;
        await tx.botOrders.deleteDraft(conversationId);
        return draft.expiresAt > new Date();
      });
    } catch (error) {
      if (error instanceof CommerceUnavailableError) return false;
      throw error;
    }
  }

  async hasBotOrderDraft(
    ws: WorkspaceId,
    conversationId: string,
  ): Promise<{ pending: boolean; storedAt: Date | null }> {
    const none = { pending: false, storedAt: null };
    if (!isUuid(conversationId)) return none;
    try {
      const draft = await this.store.run(ws, (tx) => tx.botOrders.findDraft(conversationId));
      return draft && draft.expiresAt > new Date()
        ? { pending: true, storedAt: draft.createdAt }
        : none;
    } catch (error) {
      if (error instanceof CommerceUnavailableError) return none;
      throw error;
    }
  }
}
