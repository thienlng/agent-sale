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
  branches(c: KvCredentials): Promise<KvBranch[]>;
  products(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date },
  ): Promise<KvPage<KvProduct>>;
  productById(c: KvCredentials, id: number): Promise<KvProduct | null>;
  onHands(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date; branchIds: number[] },
  ): Promise<KvPage<KvOnHand>>;
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
