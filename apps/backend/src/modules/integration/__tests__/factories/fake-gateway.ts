import type {
  KiotVietGateway,
  KvBranch,
  KvCredentials,
  KvOnHand,
  KvOrderRef,
  KvOrderSummary,
  KvPage,
  KvWebhook,
} from '../../application/ports/kiotviet-gateway.js';
import type { KvCustomer, KvCustomerBody } from '../../domain/kiotviet-customer.js';
import type { KvProduct } from '../../domain/kiotviet-mapping.js';
import type { KvOrderBody } from '../../domain/kiotviet-order.js';

/** An order the fake KiotViet holds. */
export interface FakeGatewayOrder extends KvOrderSummary {
  branchId: number;
  body: KvOrderBody;
}

/**
 * In-memory KiotVietGateway for service and HTTP tests. `fail` makes the named method throw;
 * `calls` records method names with the interactive flag, so tests can check which view was used.
 */
export class FakeKiotVietGateway implements KiotVietGateway {
  branchList: KvBranch[] = [
    { id: 1, name: 'Trung tâm', address: '1 Lê Lợi' },
    { id: 2, name: 'Kho', address: null },
  ];
  codes: string[] = ['SP1', 'SP2', 'SP3'];
  webhooks: Array<KvWebhook & { secretBase64: string; credentials: KvCredentials }> = [];
  fail: Partial<Record<keyof KiotVietGateway, Error>> = {};
  calls: Array<{ method: string; interactive: boolean; credentials: KvCredentials | undefined }> =
    [];
  codesRead = 0;
  orders: FakeGatewayOrder[] = [];
  /** Errors the next `createOrder` calls throw *after* storing the order (an answer lost on the way back). */
  lostCreates: Error[] = [];
  /**
   * What `productById` answers. `createOrder` adds each line's quantity to the product's `reserved`
   * in the order branch, as KiotViet reserves an order's goods.
   */
  productsById: KvProduct[] = [];
  /** The store's customers (`customers`, `customerById`, `customersByPhone`, `createCustomer`). */
  customerList: KvCustomer[] = [];
  /** Answered as `removedIds` by every `customers` page (`includeRemoveIds`). */
  removedCustomerIds: number[] = [];
  /** Bodies `createCustomer` received. */
  createdCustomers: KvCustomerBody[] = [];
  /** Errors the next `createCustomer` calls throw *after* storing the customer (a lost answer). */
  lostCustomerCreates: Error[] = [];
  /** What `productCount` answers; defaults to the number of codes. */
  total: number | null | undefined = undefined;
  private nextWebhookId = 100;
  private readonly view: KiotVietGateway;

  constructor() {
    const record = (method: keyof KiotVietGateway, c?: KvCredentials) =>
      this.track(method, true, c);
    // The interactive view shares the same state; only the recorded flag differs.
    this.view = {
      interactive: () => this.view,
      branches: (c) => (record('branches', c), this.doBranches()),
      products: (c, q) => (record('products', c), this.products(c, q)),
      productById: (c, id) => (record('productById', c), this.productById(c, id)),
      onHands: (c, q) => (record('onHands', c), this.onHands(c, q)),
      productCount: (c) => (record('productCount', c), this.doCount()),
      productCodes: (c) => (record('productCodes', c), this.doCodes()),
      registerWebhook: (c, w) => (record('registerWebhook', c), this.doRegister(c, w)),
      deleteWebhook: (c, id) => (record('deleteWebhook', c), this.doDelete(id)),
      listWebhooks: (c) => (record('listWebhooks', c), this.doList()),
      createOrder: (c, b) => (record('createOrder', c), this.createOrder(c, b)),
      recentOrders: (c, q) => (record('recentOrders', c), this.recentOrders(c, q)),
      orderById: (c, id) => (record('orderById', c), this.orderById(c, id)),
      customers: (c, q) => (record('customers', c), this.customers(c, q)),
      customerById: (c, id) => (record('customerById', c), this.customerById(c, id)),
      customersByPhone: (c, n) => (record('customersByPhone', c), this.customersByPhone(c, n)),
      createCustomer: (c, b) => (record('createCustomer', c), this.createCustomer(c, b)),
    };
  }

  interactive(): KiotVietGateway {
    return this.view;
  }

  branches(c: KvCredentials): Promise<KvBranch[]> {
    this.track('branches', false, c);
    return this.doBranches();
  }

  products(_c: KvCredentials, _q: unknown): Promise<KvPage<KvProduct>> {
    return Promise.resolve({ data: [], total: 0, removedIds: [] });
  }

  productById(_c: KvCredentials, id: number): Promise<KvProduct | null> {
    if (this.fail.productById) return Promise.reject(this.fail.productById);
    const found = this.productsById.find((p) => p.id === id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  onHands(_c: KvCredentials, _q: unknown): Promise<KvPage<KvOnHand>> {
    return Promise.resolve({ data: [], total: 0, removedIds: [] });
  }

  productCount(c: KvCredentials): Promise<number | null> {
    this.track('productCount', false, c);
    return this.doCount();
  }

  productCodes(c: KvCredentials): AsyncIterable<string> {
    this.track('productCodes', false, c);
    return this.doCodes();
  }

  registerWebhook(
    c: KvCredentials,
    w: { type: string; url: string; secretBase64: string },
  ): Promise<number> {
    this.track('registerWebhook', false, c);
    return this.doRegister(c, w);
  }

  deleteWebhook(c: KvCredentials, id: number): Promise<void> {
    this.track('deleteWebhook', false, c);
    return this.doDelete(id);
  }

  listWebhooks(c: KvCredentials): Promise<KvWebhook[]> {
    this.track('listWebhooks', false, c);
    return this.doList();
  }

  private doList(): Promise<KvWebhook[]> {
    if (this.fail.listWebhooks) return Promise.reject(this.fail.listWebhooks);
    return Promise.resolve(this.webhooks.map(({ id, type, url }) => ({ id, type, url })));
  }

  createOrder(c: KvCredentials, body: KvOrderBody): Promise<KvOrderRef> {
    this.track('createOrder', false, c);
    if (this.fail.createOrder) return Promise.reject(this.fail.createOrder);
    const id = 7000 + this.orders.length + 1;
    const order: FakeGatewayOrder = {
      id,
      code: `DH${id}`,
      status: 1,
      description: body.description,
      branchId: body.branchId,
      body: structuredClone(body),
    };
    this.orders.push(order);
    for (const line of body.orderDetails) {
      const inv = this.productsById
        .find((p) => p.id === line.productId)
        ?.inventories?.find((i) => i.branchId === body.branchId);
      if (inv) inv.reserved += line.quantity;
    }
    const lost = this.lostCreates.shift();
    if (lost) return Promise.reject(lost);
    return Promise.resolve({ id, code: order.code, status: order.status });
  }

  recentOrders(
    c: KvCredentials,
    q: { branchId: number; since: Date; currentItem: number; pageSize: number },
  ): Promise<KvPage<KvOrderSummary>> {
    this.track('recentOrders', false, c);
    if (this.fail.recentOrders) return Promise.reject(this.fail.recentOrders);
    const rows = this.orders
      .filter((o) => o.branchId === q.branchId)
      .map(({ id, code, status, description }) => ({ id, code, status, description }));
    return Promise.resolve({
      data: rows.slice(q.currentItem, q.currentItem + q.pageSize),
      total: rows.length,
      removedIds: [],
    });
  }

  orderById(c: KvCredentials, id: number): Promise<KvOrderRef | null> {
    this.track('orderById', false, c);
    if (this.fail.orderById) return Promise.reject(this.fail.orderById);
    const o = this.orders.find((x) => x.id === id);
    return Promise.resolve(o ? { id: o.id, code: o.code, status: o.status } : null);
  }

  customers(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date },
  ): Promise<KvPage<KvCustomer>> {
    this.track('customers', false, c);
    if (this.fail.customers) return Promise.reject(this.fail.customers);
    return Promise.resolve({
      data: structuredClone(this.customerList.slice(q.currentItem, q.currentItem + q.pageSize)),
      total: this.customerList.length,
      removedIds: [...this.removedCustomerIds],
    });
  }

  customerById(c: KvCredentials, id: number): Promise<KvCustomer | null> {
    this.track('customerById', false, c);
    if (this.fail.customerById) return Promise.reject(this.fail.customerById);
    const found = this.customerList.find((x) => x.id === id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  customersByPhone(c: KvCredentials, contactNumber: string): Promise<KvCustomer[]> {
    this.track('customersByPhone', false, c);
    if (this.fail.customersByPhone) return Promise.reject(this.fail.customersByPhone);
    return Promise.resolve(
      structuredClone(
        this.customerList.filter((x) => (x.contactNumber ?? '').includes(contactNumber)),
      ),
    );
  }

  createCustomer(c: KvCredentials, body: KvCustomerBody): Promise<{ id: number }> {
    this.track('createCustomer', false, c);
    if (this.fail.createCustomer) return Promise.reject(this.fail.createCustomer);
    this.createdCustomers.push(structuredClone(body));
    const id = 9000 + this.customerList.length + 1;
    this.customerList.push(kvCustomer(id, { name: body.name, contactNumber: body.contactNumber }));
    const lost = this.lostCustomerCreates.shift();
    if (lost) return Promise.reject(lost);
    return Promise.resolve({ id });
  }

  private track(method: keyof KiotVietGateway, interactive: boolean, c?: KvCredentials) {
    this.calls.push({ method, interactive, credentials: c });
  }

  private doBranches(): Promise<KvBranch[]> {
    if (this.fail.branches) return Promise.reject(this.fail.branches);
    return Promise.resolve(structuredClone(this.branchList));
  }

  private doCount(): Promise<number | null> {
    if (this.fail.productCount) return Promise.reject(this.fail.productCount);
    return Promise.resolve(this.total === undefined ? this.codes.length : this.total);
  }

  private async *doCodes(): AsyncIterable<string> {
    if (this.fail.productCodes) throw this.fail.productCodes;
    for (const code of this.codes) {
      this.codesRead += 1;
      yield code;
    }
  }

  private doRegister(
    c: KvCredentials,
    w: { type: string; url: string; secretBase64: string },
  ): Promise<number> {
    if (this.fail.registerWebhook) return Promise.reject(this.fail.registerWebhook);
    const id = this.nextWebhookId++;
    this.webhooks.push({ id, ...w, credentials: c });
    return Promise.resolve(id);
  }

  private doDelete(id: number): Promise<void> {
    if (this.fail.deleteWebhook) return Promise.reject(this.fail.deleteWebhook);
    this.webhooks = this.webhooks.filter((h) => h.id !== id);
    return Promise.resolve();
  }
}

/** A KiotViet customer for tests. */
export function kvCustomer(id: number, over: Partial<KvCustomer> = {}): KvCustomer {
  return {
    id,
    code: `KH${id}`,
    name: `Khách ${id}`,
    contactNumber: null,
    email: null,
    address: null,
    wardName: null,
    locationName: null,
    birthDate: null,
    gender: null,
    ...over,
  };
}
