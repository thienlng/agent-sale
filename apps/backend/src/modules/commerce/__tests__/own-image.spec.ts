import type { UpsertProductRequest } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { CatalogService } from '../application/catalog.service.js';
import type { CommerceStore } from '../application/ports/commerce-store.js';
import { ownImageProblem } from '../domain/own-image.js';

const WS = '0192f0a0-0000-7000-8000-000000000001' as WorkspaceId;
const OTHER = '0192f0a0-0000-7000-8000-000000000002';
const BASE = 'https://cdn.test';

const storage = (configured = true): PublicObjectStorage => ({
  put: () => Promise.reject(new Error('unused')),
  remove: () => Promise.resolve(),
  isPublicUrlUnder: (url, prefix) => configured && url.startsWith(`${BASE}/${prefix}`),
});

describe('ownImageProblem', () => {
  const check = (url: string, configured = true) => ownImageProblem(url, WS, storage(configured));
  it('accepts a file under the workspace prefix', () => {
    expect(check(`${BASE}/products/${WS}/abc.jpg`)).toBeNull();
    expect(check(`${BASE}/products/${WS}/abc.jpeg`)).toBeNull();
    expect(check(`${BASE}/products/${WS}/abc.png`)).toBeNull();
  });
  it('rejects WebP (Messenger rejects it in albums)', () => {
    expect(check(`${BASE}/products/${WS}/abc.webp`)).toBe('IMAGE_NOT_UPLOADED');
  });
  it('rejects external links, other workspaces, traversal and unconfigured storage', () => {
    expect(check('https://img.example.com/a.jpg')).toBe('IMAGE_NOT_UPLOADED');
    expect(check(`${BASE}/products/${OTHER}/abc.jpg`)).toBe('IMAGE_NOT_UPLOADED');
    expect(check(`${BASE}/products/${WS}/../${OTHER}/abc.jpg`)).toBe('IMAGE_NOT_UPLOADED');
    expect(check(`${BASE}/products/${WS}/%2e%2e/x.jpg`)).toBe('IMAGE_NOT_UPLOADED');
    expect(check(`${BASE}/products/${WS}/a/b.jpg`)).toBe('IMAGE_NOT_UPLOADED');
    expect(check(`${BASE}/products/${WS}/abc.jpg?x=1`)).toBe('IMAGE_NOT_UPLOADED');
    expect(check(`${BASE}/products/${WS}/abc.jpg`, false)).toBe('IMAGE_NOT_UPLOADED');
  });
});

const accommodation = (gallery: { url: string; caption: string }[]) => ({
  rentalType: 'entire_property' as const,
  bedrooms: 1,
  standardAdults: 2,
  standardChildren: 0,
  childAgeBelow: 6,
  maxGuests: null,
  roomLayout: [{ name: 'Room', beds: '1 bed' }],
  amenities: [],
  rateBasis: 'unconfirmed' as const,
  rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1 }],
  gallery,
});
const product = (over: Partial<UpsertProductRequest>): UpsertProductRequest =>
  ({
    code: 'P1',
    name: 'P',
    variants: [{ sku: 'S1', price: 1 }],
    ...over,
  }) as UpsertProductRequest;

describe('CatalogService image rule', () => {
  // The rule runs before any store access, so a store that throws proves the rejection.
  const store = {
    run: () => Promise.reject(new Error('store reached')),
  } as unknown as CommerceStore;
  const service = (configured = true) => new CatalogService(store, storage(configured));
  const reason = async (run: () => Promise<unknown>) => {
    const err = await Promise.resolve()
      .then(run)
      .then(
        () => null,
        (e: unknown) => e as { code: string; details?: Record<string, unknown> },
      );
    return err;
  };
  const own = `${BASE}/products/${WS}/a.jpg`;

  it('rejects an external product image on create and update, naming the field', async () => {
    const bad = product({ imageUrls: [own, 'https://img.example.com/a.jpg'] });
    for (const run of [
      () => service().createProduct(WS, bad),
      () => service().updateProduct(WS, OTHER, bad),
    ]) {
      const err = await reason(run);
      expect(err?.code).toBe('VALIDATION_FAILED');
      expect(err?.details).toEqual({ reason: 'IMAGE_NOT_UPLOADED', field: 'imageUrls[1]' });
    }
  });
  it('rejects another workspace image and every image when storage is not configured', async () => {
    const theirs = product({ imageUrls: [`${BASE}/products/${OTHER}/a.jpg`] });
    expect((await reason(() => service().createProduct(WS, theirs)))?.details?.reason).toBe(
      'IMAGE_NOT_UPLOADED',
    );
    const mine = product({ imageUrls: [own] });
    expect((await reason(() => service(false).createProduct(WS, mine)))?.details?.reason).toBe(
      'IMAGE_NOT_UPLOADED',
    );
  });
  it('accepts an own image (reaches the store)', async () => {
    const err = await reason(() => service().createProduct(WS, product({ imageUrls: [own] })));
    expect(err).toBeInstanceOf(Error);
    expect((err as unknown as Error).message).toBe('store reached');
  });
  it('applies the same rule to accommodation gallery urls', async () => {
    const bad = product({
      accommodation: accommodation([
        { url: own, caption: 'ok' },
        { url: 'https://img.example.com/x.jpg', caption: 'bad' },
      ]),
    });
    for (const run of [
      () => service().createProduct(WS, bad),
      () => service().updateProduct(WS, OTHER, bad),
    ]) {
      const err = await reason(run);
      expect(err?.details).toEqual({ reason: 'IMAGE_NOT_UPLOADED', field: 'gallery[1].url' });
    }
    const ok = product({ accommodation: accommodation([{ url: own, caption: 'ok' }]) });
    expect(
      ((await reason(() => service().createProduct(WS, ok))) as unknown as Error).message,
    ).toBe('store reached');
  });
});
