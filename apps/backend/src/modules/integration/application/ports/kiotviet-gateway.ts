import type { KvProduct } from '../../domain/kiotviet-mapping.js';

/** What a KiotViet API connection needs; the secret never leaves the client or the log. */
export interface KvCredentials {
  retailer: string;
  clientId: string;
  clientSecret: string;
}

/** One page of a KiotViet list. `removedIds` merges `removeId` (products) and `removedIds` (others). */
export interface KvPage<T> {
  data: T[];
  total: number;
  removedIds: number[];
}

export interface KvBranch {
  id: number;
  name: string;
  address: string | null;
}

export interface KvOnHand {
  productId: number;
  inventories: Array<{ branchId: number; onHand: number; reserved: number }>;
}

export interface KvWebhook {
  id: number;
  type: string;
  url: string;
}

/**
 * KiotViet public API (spec §3). Errors: `KiotVietAuthError` (token rejected),
 * `KiotVietRetailerError` (store unknown), `KiotVietPermissionError` (403),
 * `KiotVietUnavailableError` (down, timing out or rate limited beyond retries).
 */
export interface KiotVietGateway {
  /**
   * The same gateway for calls the owner waits on (connect wizard): one try with a ~10 s timeout,
   * no retries or `Retry-After` waits. Background jobs use the gateway itself (full retry schedule).
   */
  interactive(): KiotVietGateway;
  branches(c: KvCredentials): Promise<KvBranch[]>;
  /** `includeInventory` adds each product's branch stock (off by default: stock has its own list). */
  products(
    c: KvCredentials,
    q: {
      currentItem: number;
      pageSize: number;
      lastModifiedFrom?: Date;
      includeInventory?: boolean;
    },
  ): Promise<KvPage<KvProduct>>;
  productById(c: KvCredentials, id: number): Promise<KvProduct | null>;
  onHands(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date; branchIds: number[] },
  ): Promise<KvPage<KvOnHand>>;
  /** The store's product total from a one-item page; null when KiotViet does not say. */
  productCount(c: KvCredentials): Promise<number | null>;
  /** Every product code, page by page (pageSize 100); callers may stop early. */
  productCodes(c: KvCredentials): AsyncIterable<string>;
  registerWebhook(
    c: KvCredentials,
    w: { type: string; url: string; secretBase64: string },
  ): Promise<number>;
  deleteWebhook(c: KvCredentials, id: number): Promise<void>;
  listWebhooks(c: KvCredentials): Promise<KvWebhook[]>;
}

export const KIOTVIET_GATEWAY = Symbol('KIOTVIET_GATEWAY');
