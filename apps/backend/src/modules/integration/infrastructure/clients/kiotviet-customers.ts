import type { z } from 'zod';

import type { KvCredentials, KvPage } from '../../application/ports/kiotviet-gateway.js';
import type { KvCustomer, KvCustomerBody } from '../../domain/kiotviet-customer.js';
import type { CallOptions, Query } from './kiotviet-call.js';
import { parsePayload } from './kiotviet-payload.js';
import { KvCustomerIdSchema, KvCustomerSchema } from './kiotviet.schemas.js';

/** The client's transport (token, budget, retries) as the customer calls use it. */
export interface KvTransport {
  call(c: KvCredentials, method: string, path: string, opts?: CallOptions): Promise<unknown>;
  list<S extends z.ZodType>(
    c: KvCredentials,
    path: string,
    query: Query,
    schema: S,
  ): Promise<KvPage<z.output<S>>>;
}

const PAGE_SIZE = 100;

export interface CustomerPageQuery {
  currentItem: number;
  pageSize: number;
  lastModifiedFrom?: Date;
}
/** A stable order for paging `/customers` (like `PRODUCT_ORDER`; to verify on a trial store). */
export const CUSTOMER_ORDER = { orderBy: 'id', orderDirection: 'Asc' } as const;

/** KiotViet customer endpoints (PR 3), on the client's transport. Never logs customer data. */
export class KiotVietCustomerApi {
  constructor(private readonly t: KvTransport) {}

  customers(c: KvCredentials, q: CustomerPageQuery): Promise<KvPage<KvCustomer>> {
    return this.t.list(
      c,
      '/customers',
      {
        currentItem: q.currentItem,
        pageSize: Math.min(q.pageSize, PAGE_SIZE),
        includeRemoveIds: true,
        lastModifiedFrom: q.lastModifiedFrom?.toISOString(),
        ...CUSTOMER_ORDER,
      },
      KvCustomerSchema,
    );
  }

  async customerById(c: KvCredentials, id: number): Promise<KvCustomer | null> {
    const raw = await this.t.call(c, 'GET', `/customers/${id}`, { allowNotFound: true });
    if (raw === null) return null;
    return parsePayload(KvCustomerSchema, raw, 'GET /customers/{id}');
  }

  async customersByPhone(c: KvCredentials, contactNumber: string): Promise<KvCustomer[]> {
    const page = await this.t.list(
      c,
      '/customers',
      { contactNumber, currentItem: 0, pageSize: PAGE_SIZE, ...CUSTOMER_ORDER },
      KvCustomerSchema,
    );
    return page.data;
  }

  async createCustomer(c: KvCredentials, body: KvCustomerBody): Promise<{ id: number }> {
    const raw = await this.t.call(c, 'POST', '/customers', { body, once: true });
    return parsePayload(KvCustomerIdSchema, raw, 'POST /customers');
  }
}
