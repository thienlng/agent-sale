import type {
  KiotVietGateway,
  KvBranch,
  KvCredentials,
  KvOnHand,
  KvPage,
  KvWebhook,
} from '../../application/ports/kiotviet-gateway.js';
import type { KvProduct } from '../../domain/kiotviet-mapping.js';

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
      listWebhooks: (c) => (record('listWebhooks', c), this.listWebhooks(c)),
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

  productById(_c: KvCredentials, _id: number): Promise<KvProduct | null> {
    return Promise.resolve(null);
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

  listWebhooks(_c: KvCredentials): Promise<KvWebhook[]> {
    return Promise.resolve(this.webhooks.map(({ id, type, url }) => ({ id, type, url })));
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
