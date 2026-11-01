import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import { INTEGRATION_OPTIONS, type IntegrationOptions } from './integration-options.js';
import type { ConnectionRecord, ConnectionSettings } from './ports/integration-store.js';
import {
  KIOTVIET_GATEWAY,
  type KiotVietGateway,
  type KvCredentials,
} from './ports/kiotviet-gateway.js';

/** Events that keep the catalog fresh between reconciles (spec §5.3). */
export const CATALOG_WEBHOOKS = ['product.update', 'product.delete', 'stock.update'] as const;
/** Status changes of pushed orders (spec §7), registered while `pushOrders` is on. */
export const ORDER_WEBHOOK = 'order.update';
/** Customer changes (spec §4.4), registered while `syncCustomers` is on. */
export const CUSTOMER_WEBHOOKS = ['customer.update', 'customer.delete'] as const;
/** Types that follow a switch: removed from KiotViet when it is off. */
const SWITCHED: ReadonlySet<string> = new Set([ORDER_WEBHOOK, ...CUSTOMER_WEBHOOKS]);

/** The webhook types a connection with these settings needs. */
export function webhookTypes(
  s: Pick<ConnectionSettings, 'pushOrders' | 'syncCustomers'>,
): string[] {
  return [
    ...CATALOG_WEBHOOKS,
    ...(s.pushOrders ? [ORDER_WEBHOOK] : []),
    ...(s.syncCustomers ? CUSTOMER_WEBHOOKS : []),
  ];
}

/** What `ensure` left at KiotViet: every webhook id at the connection URL, and types still missing. */
export interface EnsuredWebhooks {
  webhookIds: number[];
  /** Types that failed to register (the next reconcile tries again). */
  missing: number;
  expected: number;
}

/**
 * The KiotViet webhooks of a connection, all at `${PUBLIC_WEBHOOK_BASE_URL}/webhooks/kiotviet/<token>`
 * (spec §4.6, §5.3, §7). Connect registers them; a settings save and every reconcile ensure the set
 * (`order.update` follows `pushOrders`, `customer.update`/`customer.delete` follow `syncCustomers`);
 * disconnect deletes them. Callers choose the gateway view:
 * the owner waits on connect, settings and disconnect (interactive), not on a reconcile.
 */
@Injectable()
export class WebhookSet {
  private readonly logger = new Logger(WebhookSet.name);

  constructor(
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(INTEGRATION_OPTIONS) private readonly options: IntegrationOptions,
  ) {}

  /** The connection's webhook URL; null without a public base URL (nothing is registered). */
  url(c: Pick<ConnectionRecord, 'webhookToken'>): string | null {
    const base = this.options.webhookBaseUrl?.replace(/\/+$/, '');
    return base ? `${base}/webhooks/kiotviet/${c.webhookToken}` : null;
  }

  /**
   * Registers each type in turn, handing every id to `saved` as soon as KiotViet returns it (so a
   * later failure never leaves a webhook Rapiz cannot delete). Stops at the first failure.
   */
  async register(
    c: ConnectionRecord,
    creds: KvCredentials,
    secretBase64: string,
    saved: (ids: number[]) => Promise<void>,
  ): Promise<{ registered: number; expected: number; failure: string }> {
    const types = webhookTypes(c.settings);
    const url = this.url(c);
    if (!url)
      return { registered: 0, expected: types.length, failure: 'no_public_webhook_base_url' };
    const kv = this.gateway.interactive();
    const ids: number[] = [];
    for (const type of types) {
      try {
        ids.push(await kv.registerWebhook(creds, { type, url, secretBase64 }));
      } catch (error) {
        return { registered: ids.length, expected: types.length, failure: errorName(error) };
      }
      await saved([...ids]);
    }
    return { registered: ids.length, expected: types.length, failure: '' };
  }

  /**
   * Lists the webhooks at the connection URL, registers the types `c.settings` needs and lacks, and
   * deletes the switched types whose switch is off (`order.update` with push off, the customer
   * types with customer sync off). Registration failures are counted, not thrown; a
   * failing list throws. Null without a public base URL.
   */
  async ensure(
    c: ConnectionRecord,
    creds: KvCredentials,
    view: { interactive: boolean },
  ): Promise<EnsuredWebhooks | null> {
    const url = this.url(c);
    if (!url) return null;
    const kv = view.interactive ? this.gateway.interactive() : this.gateway;
    const want = webhookTypes(c.settings);
    const ours = (await kv.listWebhooks(creds)).filter((h) => atConnection(h.url, c));
    const ids: number[] = [];
    for (const h of ours) {
      const type = h.type.toLowerCase();
      if (SWITCHED.has(type) && !want.includes(type)) {
        try {
          await kv.deleteWebhook(creds, h.id);
          continue;
        } catch (error) {
          this.logger.warn(`Connection ${c.id}: webhook ${h.id} not deleted (${errorName(error)})`);
        }
      }
      ids.push(h.id);
    }
    const have = new Set(ours.map((h) => h.type.toLowerCase()));
    let missing = 0;
    for (const type of want.filter((t) => !have.has(t))) {
      try {
        const secretBase64 = this.secrets.open(c.webhookSecretSealed);
        ids.push(await kv.registerWebhook(creds, { type, url, secretBase64 }));
      } catch (error) {
        missing += 1;
        this.logger.warn(
          `Connection ${c.id}: webhook ${type} not registered (${errorName(error)})`,
        );
      }
    }
    return { webhookIds: ids.sort((a, b) => a - b), missing, expected: want.length };
  }

  /**
   * Deletes the saved webhook ids plus any webhook KiotViet lists at this connection's URL (one
   * registered but never saved). Best effort throughout.
   */
  async deleteAll(c: ConnectionRecord, creds: KvCredentials): Promise<void> {
    const kv = this.gateway.interactive();
    const ids = new Set(c.settings.webhookIds ?? []);
    try {
      for (const h of await kv.listWebhooks(creds)) if (atConnection(h.url, c)) ids.add(h.id);
    } catch (error) {
      this.logger.warn(`Connection ${c.id}: webhooks not listed (${errorName(error)})`);
    }
    for (const id of ids) {
      try {
        await kv.deleteWebhook(creds, id);
      } catch (error) {
        this.logger.warn(`Connection ${c.id}: webhook ${id} not deleted (${errorName(error)})`);
      }
    }
  }
}

/** A webhook at this connection's URL (whatever base URL it was registered with). */
const atConnection = (url: string, c: Pick<ConnectionRecord, 'webhookToken'>): boolean =>
  url.replace(/\/+$/, '').endsWith(`/webhooks/kiotviet/${c.webhookToken}`);

/** Whether two id lists hold the same ids. */
export function sameWebhookIds(a: readonly number[], b: readonly number[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';
