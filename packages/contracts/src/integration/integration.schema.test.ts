import { describe, expect, it } from 'vitest';

import { ProductDto, ProductListQuery } from '../commerce/commerce.schema.js';
import { integrationRoutes } from './integration.routes.js';
import {
  ConnectionDto,
  ConnectKiotVietRequest,
  KiotVietCredentials,
  KiotVietSettings,
  UpdateKiotVietRequest,
} from './integration.schema.js';

const settings = {
  saleBranchIds: [1, 2],
  orderBranchId: 2,
  pushOrders: true,
  syncCustomers: false,
};

describe('KiotViet settings', () => {
  it('accepts an order branch that is one of the sale branches', () => {
    expect(KiotVietSettings.parse(settings)).toEqual(settings);
  });

  it('rejects an order branch outside the sale branches', () => {
    const result = KiotVietSettings.safeParse({ ...settings, orderBranchId: 3 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['orderBranchId']);
  });

  it('needs at least one sale branch and at most fifty', () => {
    expect(KiotVietSettings.safeParse({ ...settings, saleBranchIds: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => i + 1);
    expect(KiotVietSettings.safeParse({ ...settings, saleBranchIds: many }).success).toBe(false);
  });
});

describe('KiotViet credentials', () => {
  it('trims every field', () => {
    expect(
      KiotVietCredentials.parse({ retailer: ' shop ', clientId: ' id ', clientSecret: ' s ' }),
    ).toEqual({ retailer: 'shop', clientId: 'id', clientSecret: 's' });
  });

  it('rejects blank fields', () => {
    expect(
      KiotVietCredentials.safeParse({ retailer: '  ', clientId: 'id', clientSecret: 's' }).success,
    ).toBe(false);
  });

  it('connect request carries credentials and settings; update needs a version', () => {
    const creds = { retailer: 'shop', clientId: 'id', clientSecret: 's' };
    expect(ConnectKiotVietRequest.parse({ ...creds, settings })).toEqual({ ...creds, settings });
    expect(UpdateKiotVietRequest.safeParse({ settings }).success).toBe(false);
    expect(UpdateKiotVietRequest.parse({ version: 3 })).toEqual({ version: 3 });
  });
});

describe('connection DTO', () => {
  it('never exposes the client secret', () => {
    expect(Object.keys(ConnectionDto.shape)).not.toContain('clientSecret');
    expect(Object.keys(ConnectionDto.shape)).toContain('clientIdMasked');
  });
});

describe('integration routes', () => {
  it('are workspace-scoped and tagged integration', () => {
    expect(integrationRoutes).toHaveLength(7);
    for (const r of integrationRoutes) {
      expect(r).toMatchObject({ auth: true, workspaceScoped: true, tag: 'integration' });
    }
  });
});

describe('product external link', () => {
  it('requires the external key and allows null', () => {
    expect(ProductDto.shape.external.parse(null)).toBeNull();
    expect(ProductDto.shape.external.parse({ source: 'kiotviet', id: '42' })).toEqual({
      source: 'kiotviet',
      id: '42',
    });
    expect(ProductDto.shape.external.safeParse({ source: 'sapo', id: '42' }).success).toBe(false);
  });

  it('list query filters by source', () => {
    expect(ProductListQuery.parse({ source: 'kiotviet' }).source).toBe('kiotviet');
    expect(ProductListQuery.parse({}).source).toBeUndefined();
    expect(ProductListQuery.safeParse({ source: 'other' }).success).toBe(false);
  });
});
