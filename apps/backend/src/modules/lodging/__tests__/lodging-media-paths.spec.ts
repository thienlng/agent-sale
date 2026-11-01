import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { propertyValues, toProperty } from '../infrastructure/persistence/lodging.rows.js';

const WS = '01890000-0000-7000-8000-000000000001';
const OLD = 'https://scholar-images-location-module.trycloudflare.com/media';
const key = `products/${WS}/01890000-0000-7000-8000-0000000000aa.jpg`;

const row = {
  id: '01890000-0000-7000-8000-000000000002',
  code: 'A17',
  name: 'Villa',
  area: '',
  address: '',
  description: '',
  sellMode: 'whole',
  status: 'active',
  standardAdults: 2,
  standardChildren: 0,
  maxGuests: null,
  childFreeBelow: 6,
  childAdultFrom: 12,
  amenities: [],
  layout: [],
  policies: {},
  gallery: [
    { url: `${OLD}/${key}`, caption: 'Mặt tiền' },
    { url: 'https://img.example.com/a.jpg', caption: 'Link ngoài' },
    { url: 'https://cdn.shop.vn/media/products/villa-1.jpg', caption: 'CDN ngoài' },
  ],
  internalNote: '',
  extraAdultSell: null,
  extraAdultCost: null,
  extraChildSell: null,
  extraChildCost: null,
  sortOrder: 0,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Parameters<typeof toProperty>[0];

describe('lodging gallery pictures as /media/ paths', () => {
  it('reads a photo stored on a former tunnel host as its relative path', () => {
    expect(toProperty(row).gallery).toEqual([
      { url: `/media/${key}`, caption: 'Mặt tiền' },
      { url: 'https://img.example.com/a.jpg', caption: 'Link ngoài' },
      { url: 'https://cdn.shop.vn/media/products/villa-1.jpg', caption: 'CDN ngoài' },
    ]);
    expect(propertyValues(workspaceId(WS), toProperty(row)).gallery[2]?.url).toBe(
      'https://cdn.shop.vn/media/products/villa-1.jpg',
    );
  });
  it('stores Rapiz photos as their path, whatever host the editor sent', () => {
    const p = {
      ...toProperty(row),
      gallery: [{ url: `https://other.test/media/${key}`, caption: '' }],
    };
    expect(propertyValues(workspaceId(WS), p).gallery).toEqual([
      { url: `/media/${key}`, caption: '' },
    ]);
  });
});
