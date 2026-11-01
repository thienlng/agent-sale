import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { S3PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { CatalogService } from '../application/catalog.service.js';
import type {
  CommerceStore,
  ProductRecord,
  VariantRecord,
} from '../application/ports/commerce-store.js';

const ws = workspaceId(newId());
const PID = newId();
const VID = newId();
const OLD = 'https://scholar-images-location-module.trycloudflare.com/media';
const file = (n: number) => `products/${ws}/0192f0a0-0000-7000-8000-00000000000${n}.jpg`;

const record = (): ProductRecord =>
  ({
    id: PID,
    code: 'P1',
    name: 'Villa',
    description: '',
    category: null,
    status: 'active',
    visibleToBot: true,
    botInstructions: '',
    imageUrls: [
      `${OLD}/${file(1)}`,
      'https://img.example.com/legacy.jpg',
      'https://cdn.shop.vn/media/products/villa-1.jpg',
    ],
    accommodation: {
      rentalType: 'entire_property',
      bedrooms: 1,
      standardAdults: 2,
      standardChildren: 0,
      childAgeBelow: 6,
      maxGuests: null,
      roomLayout: [{ name: 'Room', beds: '1 bed' }],
      amenities: [],
      rateBasis: 'unconfirmed',
      rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1 }],
      gallery: [{ url: `${OLD}/${file(2)}`, caption: 'Mặt tiền' }],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as ProductRecord;

const variant = {
  id: VID,
  productId: PID,
  sku: 'P1',
  name: '',
  price: 1,
  cost: null,
  weightGram: null,
  position: 0,
  archived: false,
} as unknown as VariantRecord;

function service() {
  const saved: ProductRecord[] = [];
  const tx = {
    products: {
      find: async () => record(),
      findByCode: async () => null,
      variantsOf: async () => [variant],
      save: async (p: ProductRecord) => {
        saved.push(p);
      },
      saveVariants: async () => undefined,
      archiveVariants: async () => undefined,
    },
    inventory: { stockOf: async () => [] },
  };
  const store = { run: async (_ws: unknown, fn: (t: unknown) => unknown) => fn(tx) };
  const storage = new S3PublicObjectStorage({
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'b',
    publicUrl: 'https://now.trycloudflare.com/media',
    accessKey: 'k',
    secretKey: 's',
  });
  return { svc: new CatalogService(store as unknown as CommerceStore, storage), saved };
}

describe('product pictures as /media/ paths', () => {
  it('answers a URL stored on a former tunnel host as its relative path', async () => {
    const dto = await service().svc.getProduct(ws, PID);
    expect(dto.imageUrls).toEqual([
      `/media/${file(1)}`,
      'https://img.example.com/legacy.jpg',
      'https://cdn.shop.vn/media/products/villa-1.jpg',
    ]);
    expect(dto.accommodation?.gallery[0]?.url).toBe(`/media/${file(2)}`);
  });

  it('stores an uploaded picture as its path, whatever host the form sent', async () => {
    const { svc, saved } = service();
    await svc.updateProduct(ws, PID, {
      code: 'P1',
      name: 'Villa',
      imageUrls: [`${OLD}/${file(1)}`, `/media/${file(3)}`],
      variants: [{ id: VID, sku: 'P1', price: 1 }],
    } as never);
    expect(saved[0]?.imageUrls).toEqual([`/media/${file(1)}`, `/media/${file(3)}`]);
  });
});
