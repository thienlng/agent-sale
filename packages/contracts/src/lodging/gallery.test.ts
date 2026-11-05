import { describe, expect, it } from 'vitest';

import { AccommodationDetails } from '../commerce/lodging.schema.js';
import {
  Gallery,
  GALLERY_MAX_ITEMS,
  GalleryFolder,
  GalleryItem,
  galleryCoverUrl,
  hasGalleryImage,
  UploadLodgingVideoResponse,
} from './gallery.js';
import { PropertyInput, UpdatePropertyRequest } from './lodging.schema.js';

const WS = '0192f0a0-0000-7000-8000-000000000001';
const F = '0192f0a0-0000-7000-8000-0000000000aa';
const IMG = `/media/products/${WS}/${F}.jpg`;
const VIDEO = `/media/lodging/${WS}/${F}.mp4`;
const folder = (id: string, name: string, items: unknown[] = []) => ({ id, name, items });
const image = (url = IMG, caption?: string) => ({
  kind: 'image',
  url,
  ...(caption ? { caption } : {}),
});

describe('GalleryItem', () => {
  it('accepts an image, an uploaded video and an https link, captions optional', () => {
    expect(GalleryItem.parse(image())).toEqual({ kind: 'image', url: IMG, caption: '' });
    expect(GalleryItem.parse({ kind: 'video', url: VIDEO }).kind).toBe('video');
    expect(GalleryItem.parse({ kind: 'link', url: 'https://youtu.be/x', caption: 'Tour' })).toEqual(
      {
        kind: 'link',
        url: 'https://youtu.be/x',
        caption: 'Tour',
      },
    );
  });
  it('refuses an external video, a video as an image and a non-https link', () => {
    expect(GalleryItem.safeParse({ kind: 'video', url: 'https://youtu.be/x' }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'image', url: VIDEO }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'link', url: 'http://youtu.be/x' }).success).toBe(false);
    expect(GalleryItem.safeParse({ kind: 'link', url: 'javascript:alert(1)' }).success).toBe(false);
    expect(
      GalleryItem.safeParse({ kind: 'image', url: IMG, caption: 'x'.repeat(301) }).success,
    ).toBe(false);
  });
});

describe('GalleryFolder and Gallery', () => {
  it('trims names and checks ids', () => {
    expect(GalleryFolder.parse(folder('f-1', '  Phòng ngủ  ')).name).toBe('Phòng ngủ');
    expect(GalleryFolder.safeParse(folder('f 1', 'A')).success).toBe(false);
    expect(GalleryFolder.safeParse(folder('x'.repeat(41), 'A')).success).toBe(false);
    expect(GalleryFolder.safeParse(folder('f1', '   ')).success).toBe(false);
  });
  it('allows at most 20 folders and 200 items in all', () => {
    const many = Array.from({ length: 21 }, (_, i) => folder(`f${i}`, `F${i}`));
    expect(Gallery.safeParse(many).success).toBe(false);
    const full = [
      folder(
        'a',
        'A',
        Array.from({ length: 150 }, () => image()),
      ),
      folder(
        'b',
        'B',
        Array.from({ length: GALLERY_MAX_ITEMS - 150 }, () => image()),
      ),
    ];
    expect(Gallery.safeParse(full).success).toBe(true);
    full[1]!.items.push(image());
    expect(Gallery.safeParse(full).success).toBe(false);
  });
  it('refuses duplicate folder ids and duplicate names ignoring case', () => {
    expect(Gallery.safeParse([folder('a', 'A'), folder('a', 'B')]).success).toBe(false);
    expect(Gallery.safeParse([folder('a', 'Phòng Ngủ'), folder('b', ' phòng ngủ ')]).success).toBe(
      false,
    );
  });
});

describe('galleryCoverUrl', () => {
  const gallery = Gallery.parse([
    folder('v', 'Video', [{ kind: 'video', url: VIDEO }]),
    folder('r', 'Phòng', [
      image(`https://cdn.example.com/1.jpg`),
      image(`https://cdn.example.com/2.jpg`),
    ]),
  ]);
  it('uses the chosen cover, else the first image of the first folder that has one', () => {
    expect(galleryCoverUrl({ gallery, galleryCover: '' })).toBe('https://cdn.example.com/1.jpg');
    expect(galleryCoverUrl({ gallery, galleryCover: 'https://cdn.example.com/2.jpg' })).toBe(
      'https://cdn.example.com/2.jpg',
    );
    expect(galleryCoverUrl({ gallery: [], galleryCover: '' })).toBeNull();
    expect(hasGalleryImage(gallery, VIDEO)).toBe(false);
  });
});

describe('property gallery fields', () => {
  const base = {
    code: 'A17',
    name: 'Villa',
    sellMode: 'whole',
    standardAdults: 2,
    standardChildren: 0,
  };
  it('defaults to no folders and an automatic cover', () => {
    const parsed = PropertyInput.parse(base);
    expect(parsed.gallery).toEqual([]);
    expect(parsed.galleryCover).toBe('');
  });
  it('requires the cover to be an image of the gallery', () => {
    const gallery = [folder('r', 'Phòng', [image()])];
    expect(PropertyInput.safeParse({ ...base, gallery, galleryCover: IMG }).success).toBe(true);
    expect(
      PropertyInput.safeParse({ ...base, gallery, galleryCover: 'https://x.vn/a.jpg' }).success,
    ).toBe(false);
  });
  it('keeps PATCH partial: a lone galleryCover stays a lone field', () => {
    expect(UpdatePropertyRequest.parse({ version: 1, patch: { galleryCover: '' } }).patch).toEqual({
      galleryCover: '',
    });
  });
});

describe('bot albums and video upload response', () => {
  it('parses an accommodation with and without albums', () => {
    const acc = {
      rentalType: 'entire_property',
      bedrooms: 1,
      standardAdults: 2,
      standardChildren: 0,
      childAgeBelow: 6,
      maxGuests: null,
      roomLayout: [{ name: 'Room', beds: 'One bed' }],
      amenities: [],
      rateBasis: 'night',
      rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1 }],
      gallery: [],
    };
    expect(AccommodationDetails.parse(acc).albums).toBeUndefined();
    const withAlbums = AccommodationDetails.parse({
      ...acc,
      albums: [folder('r', 'Phòng', [image()])],
    });
    expect(withAlbums.albums?.[0]?.items[0]).toEqual({ kind: 'image', url: IMG, caption: '' });
  });
  it('answers the stored path and size of an uploaded video', () => {
    expect(UploadLodgingVideoResponse.parse({ url: VIDEO, bytes: 1024 })).toEqual({
      url: VIDEO,
      bytes: 1024,
    });
    expect(UploadLodgingVideoResponse.safeParse({ url: IMG, bytes: 1 }).success).toBe(false);
  });
});
