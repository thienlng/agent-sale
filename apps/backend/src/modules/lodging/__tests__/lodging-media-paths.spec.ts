import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_FOLDER_NAME,
  propertyValues,
  toProperty,
} from '../infrastructure/persistence/lodging.rows.js';

const WS = '01890000-0000-7000-8000-000000000001';
const OLD = 'https://scholar-images-location-module.trycloudflare.com/media';
const key = `products/${WS}/01890000-0000-7000-8000-0000000000aa.jpg`;
const clip = `lodging/${WS}/01890000-0000-7000-8000-0000000000bb.mp4`;

const row = (gallery: unknown, galleryCover = '') =>
  ({
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
    gallery,
    galleryCover,
    internalNote: '',
    extraAdultSell: null,
    extraAdultCost: null,
    extraChildSell: null,
    extraChildCost: null,
    sortOrder: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Parameters<typeof toProperty>[0];

const folders = [
  {
    id: 'front',
    name: 'Mặt tiền',
    items: [
      { kind: 'image', url: `${OLD}/${key}`, caption: 'Mặt tiền' },
      { kind: 'image', url: 'https://img.example.com/a.jpg', caption: 'Link ngoài' },
      { kind: 'image', url: 'https://cdn.shop.vn/media/products/villa-1.jpg' },
      { kind: 'video', url: `${OLD}/${clip}`, caption: '' },
      { kind: 'link', url: 'https://youtu.be/abc', caption: 'Tour' },
    ],
  },
];

describe('lodging gallery folders as /media/ paths', () => {
  it('reads Rapiz photos and videos on a former tunnel host as their relative path', () => {
    const p = toProperty(row(folders, `${OLD}/${key}`));
    expect(p.gallery).toEqual([
      {
        id: 'front',
        name: 'Mặt tiền',
        items: [
          { kind: 'image', url: `/media/${key}`, caption: 'Mặt tiền' },
          { kind: 'image', url: 'https://img.example.com/a.jpg', caption: 'Link ngoài' },
          { kind: 'image', url: 'https://cdn.shop.vn/media/products/villa-1.jpg', caption: '' },
          { kind: 'video', url: `/media/${clip}`, caption: '' },
          { kind: 'link', url: 'https://youtu.be/abc', caption: 'Tour' },
        ],
      },
    ]);
    expect(p.galleryCover).toBe(`/media/${key}`);
  });

  it('reads a flat pre-0066 list as one "Ảnh chung" folder', () => {
    const p = toProperty(
      row([{ url: `${OLD}/${key}`, caption: 'Hồ bơi' }, { url: 'https://img.example.com/b.jpg' }]),
    );
    expect(p.gallery).toEqual([
      {
        id: 'legacy',
        name: LEGACY_FOLDER_NAME,
        items: [
          { kind: 'image', url: `/media/${key}`, caption: 'Hồ bơi' },
          { kind: 'image', url: 'https://img.example.com/b.jpg', caption: '' },
        ],
      },
    ]);
    expect(toProperty(row([])).gallery).toEqual([]);
  });

  it('stores Rapiz media as its path, whatever host the editor sent, and links as they are', () => {
    const p = {
      ...toProperty(row([])),
      gallery: [
        {
          id: 'f',
          name: 'F',
          items: [
            { kind: 'image' as const, url: `https://other.test/media/${key}`, caption: '' },
            { kind: 'video' as const, url: `https://other.test/media/${clip}`, caption: '' },
            { kind: 'link' as const, url: 'https://youtu.be/abc', caption: '' },
          ],
        },
      ],
      galleryCover: `https://other.test/media/${key}`,
    };
    const values = propertyValues(workspaceId(WS), p);
    expect(values.gallery[0]?.items.map((i) => i.url)).toEqual([
      `/media/${key}`,
      `/media/${clip}`,
      'https://youtu.be/abc',
    ]);
    expect(values.galleryCover).toBe(`/media/${key}`);
  });
});
