import type { ConnectionDto, KiotVietTestResponse } from '@agent-sales/contracts';

/** Shared test data for the integration components (test-only). */
export const BRANCHES = [
  { id: 11, name: 'Chi nhánh Cầu Giấy', address: '12 Trần Thái Tông, Hà Nội' },
  { id: 12, name: 'Chi nhánh Quận 1', address: null },
];

export const TEST_RESPONSE: KiotVietTestResponse = {
  retailer: 'shopabc',
  branches: BRANCHES,
  preview: { matched: 120, created: 30, rapizOnly: 5, scanned: 155, total: 155 },
};

export function connection(over: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01',
    provider: 'kiotviet',
    status: 'connected',
    retailer: 'shopabc',
    clientIdMasked: 'abcd••••wxyz',
    settings: { saleBranchIds: [11], orderBranchId: 11, pushOrders: true, syncCustomers: true },
    branches: BRANCHES,
    counts: { products: 1240, customers: 0, ordersPushed: 0 },
    progress: null,
    lastSyncAt: new Date(Date.now() - 120_000).toISOString(),
    lastError: null,
    version: 3,
    ...over,
  };
}

export function list(conn: ConnectionDto | null) {
  return {
    providers: [
      { provider: 'kiotviet', available: true, connection: conn },
      { provider: 'sapo', available: false, connection: null },
      { provider: 'haravan', available: false, connection: null },
      { provider: 'pancake_pos', available: false, connection: null },
    ],
  };
}

export const rejected = (reason: string, extra: Record<string, unknown> = {}) => ({
  status: 400,
  body: {
    error: { code: 'VALIDATION_FAILED', message: 'rejected', details: { reason, ...extra } },
  },
});
