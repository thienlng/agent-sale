import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  CATALOG_SYNC_FACADE,
  type CatalogSyncFacade,
  ORDER_PUSH_FACADE,
  type OrderPushFacade,
} from '../../commerce/api/index.js';
import type { KvProduct } from '../domain/kiotviet-mapping.js';
import { orderStatusOf } from '../domain/kiotviet-order.js';
import { validKiotVietSignature } from '../domain/signature.js';
import { CatalogWriter, SOURCE, type WriteStats } from './catalog-writer.js';
import {
  type ClaimedWebhookEvent,
  type ConnectionRecord,
  INTEGRATION_STORE,
  type IntegrationStore,
} from './ports/integration-store.js';
import {
  KIOTVIET_GATEWAY,
  type KiotVietGateway,
  type KvCredentials,
} from './ports/kiotviet-gateway.js';
import { ConnectionGoneError } from './sync-context.js';
import { openCredentials } from './sync-credentials.js';

/**
 * The HMAC key KiotViet signs deliveries with: the webhook secret exactly as registered (its
 * base64 text). If a trial store shows KiotViet keys with the decoded bytes, change only this.
 */
export const webhookSigningKey = (registeredSecret: string): string => registeredSecret;

type Action = 'product.update' | 'product.delete' | 'stock.update' | 'order.update';
const ACTIONS: ReadonlySet<string> = new Set([
  'product.update',
  'product.delete',
  'stock.update',
  'order.update',
]);
/** Where each event names its products, best guess first (KiotViet's casing varies). */
const ID_KEYS: Record<string, readonly string[]> = {
  'product.update': ['Id', 'ProductId'],
  'product.delete': ['RemoveId', 'Id', 'ProductId'],
  'stock.update': ['ProductId', 'Id'],
  'order.update': ['Id', 'OrderId'],
};

interface Notification {
  action: string;
  ids: number[];
}

/**
 * Applies one claimed KiotViet delivery (spec §5.3). The payload is only a hint: products and
 * stock are re-read from KiotViet, never taken from `Data`. Deliveries are at-most-once; anything
 * lost here is caught by the next reconcile.
 */
@Injectable()
export class WebhookApplier {
  private readonly logger = new Logger(WebhookApplier.name);
  /** `connectionId:type` already reported as unknown by this process. */
  private readonly unknownSeen = new Set<string>();
  /**
   * Bad-signature deliveries per connection seen by this process. Only the first one reaches the
   * owner's sync log (a misconfigured or hostile sender must not flood it); the process log keeps
   * the running count.
   */
  private readonly badSignatures = new Map<string, number>();

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(CATALOG_SYNC_FACADE) private readonly catalog: CatalogSyncFacade,
    @Inject(CatalogWriter) private readonly writer: CatalogWriter,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(ORDER_PUSH_FACADE) private readonly orders: OrderPushFacade,
  ) {}

  async apply(event: ClaimedWebhookEvent): Promise<void> {
    const c = await this.store.connectionForSystem(event.connectionId);
    if (!c || c.status === 'disconnected' || c.workspaceId !== event.workspaceId) return;
    if (!this.signed(c, event)) {
      await this.badSignature(c);
      return;
    }
    try {
      const creds = openCredentials(this.secrets, c);
      for (const n of parseNotifications(event.body)) await this.notification(c, creds, n);
      // A disconnect that landed between the last item check and its write: catch it here.
      await this.writer.assertLive(c.id);
    } catch (error) {
      if (error instanceof ConnectionGoneError) {
        // Disconnected while applying: what was written after the release must not stay linked.
        await this.writer.releaseIfDisconnected(c.workspaceId);
        return;
      }
      // The reconcile repairs what this delivery missed; auth errors surface on the next job.
      this.logger.warn(`Connection ${c.id}: webhook not applied (${errorName(error)})`);
    }
  }

  /**
   * Re-reads each order from KiotViet (never the payload) and applies its status to the Rapiz order
   * pushed as it; an order KiotViet no longer has, or one Rapiz did not push, is ignored.
   */
  private async orderUpdate(c: ConnectionRecord, creds: KvCredentials, ids: number[]) {
    for (const id of ids) {
      const order = await this.gateway.orderById(creds, id);
      if (!order) continue;
      await this.orders.applyExternalOrderStatus(
        c.workspaceId,
        SOURCE,
        String(order.id),
        orderStatusOf(order.status),
      );
    }
  }

  private async badSignature(c: ConnectionRecord): Promise<void> {
    const count = (this.badSignatures.get(c.id) ?? 0) + 1;
    this.badSignatures.set(c.id, count);
    if (count === 1 || count % 100 === 0) {
      this.logger.warn(`Connection ${c.id}: ${count} webhook deliveries with a bad signature`);
    }
    if (count > 1) return;
    await this.store.log(c.workspaceId, c.id, { level: 'warning', code: 'webhook_bad_signature' });
  }

  private signed(c: ConnectionRecord, event: ClaimedWebhookEvent): boolean {
    let secret: string;
    try {
      secret = this.secrets.open(c.webhookSecretSealed);
    } catch {
      return false;
    }
    return validKiotVietSignature(
      event.body,
      event.signature ?? undefined,
      webhookSigningKey(secret),
    );
  }

  private async notification(c: ConnectionRecord, creds: KvCredentials, n: Notification) {
    if (!ACTIONS.has(n.action)) {
      const key = `${c.id}:${n.action}`;
      if (this.unknownSeen.has(key)) return;
      this.unknownSeen.add(key);
      await this.store.log(c.workspaceId, c.id, {
        level: 'info',
        code: 'webhook_unknown',
        params: { type: n.action.slice(0, 60) },
      });
      return;
    }
    if (!n.ids.length) return;
    const action = n.action as Action;
    if (action === 'order.update') {
      await this.orderUpdate(c, creds, n.ids);
      return;
    }
    if (action === 'product.delete') {
      await this.catalog.removeExternalProducts(c.workspaceId, SOURCE, n.ids.map(String));
      return;
    }
    const products: KvProduct[] = [];
    for (const id of n.ids) {
      const p = await this.gateway.productById(creds, id);
      if (p) products.push(p);
    }
    if (action === 'product.update') {
      const stats: WriteStats = { imagesFailed: 0 };
      for (const item of await this.writer.group(creds, products)) {
        await this.writer.write(c.workspaceId, c.id, item, stats);
      }
      if (stats.imagesFailed) {
        await this.store.log(c.workspaceId, c.id, {
          level: 'warning',
          code: 'image_failed',
          params: { count: stats.imagesFailed },
        });
      }
    }
    const rows = this.writer.stockRows(
      products.map((p) => ({ productId: p.id, inventories: p.inventories })),
      c.settings.saleBranchIds,
    );
    await this.catalog.setExternalStock(c.workspaceId, SOURCE, rows);
  }
}

/**
 * `{ Id, Attempt, Notifications: [{ Action, Data }] }`, read tolerantly: the action loses its
 * retailer suffix (`product.update.123` → `product.update`), ids come from numbers or from
 * `Id`/`ProductId`/`RemoveId` fields (single or arrays). Unparseable bodies yield nothing.
 */
export function parseNotifications(body: string): Notification[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = field(parsed, 'Notifications');
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): Notification[] => {
    const action = field(raw, 'Action');
    if (typeof action !== 'string' || !action.trim()) return [];
    const parts = action.trim().toLowerCase().split('.');
    const name = parts.slice(0, 2).join('.');
    const ids = new Set<number>();
    const data = field(raw, 'Data');
    for (const entry of Array.isArray(data) ? data : [data]) {
      collectIds(entry, ID_KEYS[name] ?? [], ids);
    }
    return [{ action: name, ids: [...ids] }];
  });
}

function field(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  return o[name] ?? o[name.charAt(0).toLowerCase() + name.slice(1)];
}

function collectIds(entry: unknown, keys: readonly string[], into: Set<number>): void {
  const add = (v: unknown) => {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v;
    if (typeof n === 'number' && Number.isSafeInteger(n) && n > 0) into.add(n);
  };
  if (typeof entry === 'number' || typeof entry === 'string') return add(entry);
  for (const key of keys) {
    const v = field(entry, key);
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(add);
    else add(v);
    return;
  }
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';
