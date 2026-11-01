import type { KvCustomer, KvCustomerBody } from '../../domain/kiotviet-customer.js';
import type { KvProduct } from '../../domain/kiotviet-mapping.js';
import type { KvOrderBody } from '../../domain/kiotviet-order.js';

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

export interface KvOrderRef {
  id: number;
  code: string;
  status: number;
}

export interface KvOrderSummary extends KvOrderRef {
  description: string | null;
}

export interface KvWebhook {
  id: number;
  type: string;
  url: string;
}

/**
 * KiotViet public API (spec §3). Errors: `KiotVietAuthError` (token rejected),
 * `KiotVietRetailerError` (store unknown), `KiotVietPermissionError` (403),
 * `KiotVietUnavailableError` (down, timing out or rate limited beyond retries),
 * `KiotVietRejectedError` (a write refused as invalid).
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
  /**
   * `POST /orders`. Not idempotent: only a rate-limited (429) or token-rejected (401) call is sent
   * again. A timeout, network error or 5xx throws `KiotVietUnavailableError` and the order may exist
   * (the caller looks it up by its description before trying again); a 4xx throws
   * `KiotVietRejectedError`.
   */
  createOrder(c: KvCredentials, body: KvOrderBody): Promise<KvOrderRef>;
  /** Orders of a branch modified since `since` (pageSize ≤ 100). */
  recentOrders(
    c: KvCredentials,
    q: { branchId: number; since: Date; currentItem: number; pageSize: number },
  ): Promise<KvPage<KvOrderSummary>>;
  orderById(c: KvCredentials, id: number): Promise<KvOrderRef | null>;
  /** Customers in id order (pageSize ≤ 100), with the ids deleted since `lastModifiedFrom`. */
  customers(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date },
  ): Promise<KvPage<KvCustomer>>;
  customerById(c: KvCredentials, id: number): Promise<KvCustomer | null>;
  /**
   * `GET /customers?contactNumber=` (first page). KiotViet may match loosely: callers keep only the
   * customers whose number is the one they look for (`matchesPhone`).
   */
  customersByPhone(c: KvCredentials, contactNumber: string): Promise<KvCustomer[]>;
  /**
   * `POST /customers`. Not idempotent, like `createOrder`: a timeout, network error or 5xx throws
   * `KiotVietUnavailableError` and the customer may exist (the caller looks it up by phone before
   * trying again); a 4xx throws `KiotVietRejectedError`.
   */
  createCustomer(c: KvCredentials, body: KvCustomerBody): Promise<{ id: number }>;
}

export const KIOTVIET_GATEWAY = Symbol('KIOTVIET_GATEWAY');
