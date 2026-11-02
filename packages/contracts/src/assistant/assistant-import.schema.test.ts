import { describe, expect, it } from 'vitest';

import {
  AssistantProposalDto,
  CreateImportBatchRequest,
  ImportBatchDto,
  ImportRowResultDto,
  SendAssistantMessageRequest,
} from './assistant.schema.js';

const BUSINESS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10';
const ID = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const URL = `/media/products/${BUSINESS}/${ID}.jpg`;

const sheet = (rows: string[][]) => ({
  kind: 'sheet',
  businessId: BUSINESS,
  fileName: 'sp.xlsx',
  rows,
});
const photos = (n: number, grouping = 'per_photo') => ({
  kind: 'photos',
  businessId: BUSINESS,
  grouping,
  items: Array.from({ length: n }, () => ({
    imageUrl: URL,
    mimeType: 'image/jpeg',
    base64: 'AAAA',
  })),
});

describe('CreateImportBatchRequest', () => {
  it('accepts a sheet within the limits', () => {
    expect(
      CreateImportBatchRequest.safeParse(
        sheet([
          ['Tên', 'Giá'],
          ['Áo', '1'],
        ]),
      ).success,
    ).toBe(true);
    const full = Array.from({ length: 310 }, () => Array.from({ length: 40 }, () => 'x'));
    expect(CreateImportBatchRequest.safeParse(sheet(full)).success).toBe(true);
  });

  it('refuses sheets over the limits', () => {
    const ok = (rows: string[][]) => CreateImportBatchRequest.safeParse(sheet(rows)).success;
    expect(ok([])).toBe(false);
    expect(ok(Array.from({ length: 311 }, () => ['x']))).toBe(false);
    expect(ok([Array.from({ length: 41 }, () => 'x')])).toBe(false);
    expect(ok([['x'.repeat(1001)]])).toBe(false);
    // 300 rows × 6 cells of 1 000 chars is over 1.5 MB of JSON.
    expect(
      ok(Array.from({ length: 300 }, () => Array.from({ length: 6 }, () => 'x'.repeat(1000)))),
    ).toBe(false);
    expect(
      CreateImportBatchRequest.safeParse({ ...sheet([['x']]), fileName: 'f'.repeat(201) }).success,
    ).toBe(false);
  });

  it('accepts 1 to 8 photos and refuses more, bad thumbnails and foreign links', () => {
    const ok = (body: unknown) => CreateImportBatchRequest.safeParse(body).success;
    expect(ok(photos(1))).toBe(true);
    expect(ok(photos(8))).toBe(true);
    expect(ok(photos(0))).toBe(false);
    expect(ok(photos(9))).toBe(false);
    const item = photos(1).items[0]!;
    expect(ok({ ...photos(1), items: [{ ...item, mimeType: 'image/webp' }] })).toBe(false);
    expect(ok({ ...photos(1), items: [{ ...item, base64: 'not base64!' }] })).toBe(false);
    expect(ok({ ...photos(1), items: [{ ...item, base64: 'A'.repeat(204_801) }] })).toBe(false);
    expect(ok({ ...photos(1), items: [{ ...item, imageUrl: 'http://x.test/a.jpg' }] })).toBe(false);
  });

  it('allows at most 5 photos for one product', () => {
    expect(CreateImportBatchRequest.safeParse(photos(5, 'one_product')).success).toBe(true);
    expect(CreateImportBatchRequest.safeParse(photos(6, 'one_product')).success).toBe(false);
    expect(CreateImportBatchRequest.safeParse(photos(6, 'per_photo')).success).toBe(true);
  });

  it('refuses an unknown kind', () => {
    expect(CreateImportBatchRequest.safeParse({ ...sheet([['x']]), kind: 'pdf' }).success).toBe(
      false,
    );
  });
});

describe('import DTOs', () => {
  it('parses a batch with drafts and results', () => {
    const dto = {
      id: ID,
      threadId: ID,
      businessId: BUSINESS,
      kind: 'sheet',
      fileName: 'sp.xlsx',
      status: 'ready',
      rowCount: 2,
      drafts: [
        {
          key: 'r1',
          rows: [1],
          product: {
            code: 'AT',
            name: 'Áo',
            description: '',
            category: null,
            visibleToBot: true,
            imageUrls: [],
            variants: [
              { sku: 'AT', name: '', price: null, cost: null, weightGram: null, stock: 3 },
            ],
          },
          problems: [{ field: 'price', code: 'missing_price', severity: 'error', row: 1 }],
          excluded: false,
        },
      ],
      results: { r1: { status: 'created', productId: ID }, r2: { status: 'not_run' } },
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    expect(ImportBatchDto.parse(dto)).toEqual(dto);
    expect(ImportRowResultDto.safeParse({ status: 'failed' }).success).toBe(false);
  });
});

describe('additive fields', () => {
  it('defaults the proposal kind and batch for older responses', () => {
    const older = {
      id: ID,
      threadId: ID,
      businessId: BUSINESS,
      routeKey: 'PATCH /products/{productId}',
      summary: 'Đổi giá',
      preview: null,
      status: 'pending',
      errorCode: null,
      createdAt: '2026-11-02T00:00:00.000Z',
      expiresAt: '2026-11-03T00:00:00.000Z',
      decidedAt: null,
    };
    expect(AssistantProposalDto.parse(older)).toMatchObject({ kind: 'route', importBatchId: null });
    expect(
      AssistantProposalDto.parse({ ...older, kind: 'product_import', importBatchId: ID }),
    ).toMatchObject({ kind: 'product_import', importBatchId: ID });
    expect(AssistantProposalDto.safeParse({ ...older, kind: 'bogus' }).success).toBe(false);
  });

  it('takes an optional import batch on a message', () => {
    const base = { turnId: ID, text: 'Nhập sản phẩm từ tệp sp.xlsx' };
    expect(SendAssistantMessageRequest.parse({ ...base, importBatchId: ID }).importBatchId).toBe(
      ID,
    );
    expect(SendAssistantMessageRequest.safeParse({ ...base, importBatchId: 'x' }).success).toBe(
      false,
    );
    expect(SendAssistantMessageRequest.parse(base).importBatchId).toBeUndefined();
  });
});
