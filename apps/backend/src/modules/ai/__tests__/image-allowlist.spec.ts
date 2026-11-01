import { describe, expect, it } from 'vitest';

import {
  buildAllowlist,
  imagesBlock,
  libraryImages,
  productIdOfImage,
  productImages,
  resolveImageIds,
  selectImages,
} from '../domain/image-allowlist.js';
import { ImageAllowlist } from '../application/output-tools.js';

const product = {
  id: 'prod-1',
  name: 'Giày da Oxford',
  imageUrls: [
    'https://cdn.example.com/a.jpg',
    'https://cdn.example.com/b.jpg',
    'http://x/insecure.jpg',
  ],
};

describe('image allowlist', () => {
  it('builds product image ids and drops non-https URLs', () => {
    const images = productImages([product, { id: 'prod-2', name: 'Dép', imageUrls: [] }]);
    expect(images.map((i) => i.id)).toEqual(['p:prod-1:0', 'p:prod-1:1']);
    expect(images[0]?.label).toBe('Giày da Oxford (1/2)');
  });

  it('returns every image (max 5) of a product', () => {
    const six = {
      id: 'p6',
      name: 'Bộ xếp hình',
      imageUrls: Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.jpg`),
    };
    const images = productImages([six]);
    expect(images.map((i) => i.id)).toEqual([0, 1, 2, 3, 4].map((n) => `p:p6:${n}`));
  });

  it('matches library media by title or trigger words, ignoring request filler', () => {
    const items = [
      {
        id: 'm1',
        kind: 'media',
        title: 'Bảng size giày',
        trigger: '',
        mediaUrl: 'https://cdn.example.com/size.png',
      },
      {
        id: 'm2',
        kind: 'media',
        title: 'Voucher',
        trigger: 'khuyến mãi',
        mediaUrl: 'https://cdn.example.com/v.png',
      },
      {
        id: 'm3',
        kind: 'scenario',
        title: 'Bảng size giày',
        trigger: '',
        mediaUrl: 'https://cdn.example.com/s.png',
      },
      {
        id: 'm4',
        kind: 'media',
        title: 'Bảng size giày',
        trigger: '',
        mediaUrl: 'http://cdn.example.com/s.png',
      },
    ];
    expect(libraryImages(items, 'cho xem ảnh bảng size giày').map((i) => i.id)).toEqual(['m:m1']);
    expect(libraryImages(items, 'cho xem ảnh')).toEqual([]);
  });

  it('never puts a URL in the model block', () => {
    const block = imagesBlock(productImages([product]));
    expect(block).toContain('p:prod-1:0: Giày da Oxford (1/2)');
    expect(block).not.toContain('http');
    expect(imagesBlock([])).toBe('');
  });

  it('caps the allowlist at 10 entries', () => {
    const many = productImages(
      Array.from({ length: 12 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        imageUrls: ['https://a.example/x.jpg'],
      })),
    );
    expect(buildAllowlist(many, [])).toHaveLength(10);
  });

  describe('resolveImageIds', () => {
    const allowed = productImages([
      { id: 'a', name: 'A', imageUrls: ['https://a.example/1.jpg', 'https://a.example/2.jpg'] },
      { id: 'b', name: 'B', imageUrls: ['https://b.example/1.jpg', 'https://b.example/2.jpg'] },
    ]);

    it('resolves valid ids in the requested order', () => {
      expect(resolveImageIds(['p:b:0', 'p:a:1'], allowed).map((i) => i.url)).toEqual([
        'https://b.example/1.jpg',
        'https://a.example/2.jpg',
      ]);
    });
    it('drops foreign and invented ids and URL-looking strings', () => {
      expect(
        resolveImageIds(['p:zzz:0', 'https://evil.example/x.jpg', 'p:a:9', 'p:a:0'], allowed),
      ).toEqual([{ url: 'https://a.example/1.jpg', label: 'A (1/2)' }]);
    });
    it('dedupes and caps at 3', () => {
      const ids = ['p:a:0', 'p:a:0', 'p:a:1', 'p:b:0', 'p:b:1'];
      expect(resolveImageIds(ids, allowed).map((i) => i.url)).toEqual([
        'https://a.example/1.jpg',
        'https://a.example/2.jpg',
        'https://b.example/1.jpg',
      ]);
    });
    it('returns nothing without ids', () => {
      expect(resolveImageIds(undefined, allowed)).toEqual([]);
      expect(resolveImageIds([], allowed)).toEqual([]);
    });
  });
});

describe('selectImages and productIdOfImage', () => {
  const allowed = [
    { id: 'p:prod-1:0', label: 'A', url: 'https://x.test/0.jpg' },
    { id: 'm:size', label: 'B', url: 'https://x.test/1.jpg' },
  ];
  it('keeps the allowed ids with their images, in the requested order', () => {
    expect(selectImages(['m:size', 'nope', 'p:prod-1:0', 'm:size'], allowed)).toEqual([
      allowed[1],
      allowed[0],
    ]);
  });
  it('reads the product id of a product image id only', () => {
    expect(productIdOfImage('p:prod-1:0')).toBe('prod-1');
    expect(productIdOfImage('m:size')).toBeNull();
  });
  it('lets the caller raise the allowlist cap', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `p:x:${i}`,
      label: `L${i}`,
      url: `https://x.test/${i}.jpg`,
    }));
    expect(buildAllowlist(many, [])).toHaveLength(10);
    expect(buildAllowlist(many, [], '', 60)).toHaveLength(14);
  });
});

describe('stored /media/ pictures', () => {
  const WS = '0192f0a0-0000-7000-8000-000000000001';
  const path = `/media/products/${WS}/0192f0a0-0000-7000-8000-0000000000aa.jpg`;
  const villa = {
    id: 'villa',
    name: 'Villa A20',
    accommodation: {
      gallery: [
        { url: path, caption: 'Bể bơi' },
        { url: `https://old.trycloudflare.com${path}`, caption: 'Phòng khách' },
      ],
    },
  };

  it('lists relative media paths like https links (the send path makes them absolute)', () => {
    expect(productImages([villa]).map((i) => i.url)).toEqual([
      path,
      `https://old.trycloudflare.com${path}`,
    ]);
    expect(productImages([{ id: 'p', name: 'P', imageUrls: [path, '/api/x.jpg'] }])).toHaveLength(
      1,
    );
  });

  it('sends every Rapiz picture on the CURRENT public base', () => {
    const allowlist = new ImageAllowlist(
      productImages([villa]),
      'https://now.trycloudflare.com/media',
    );
    const { images } = allowlist.resolve(['p:villa:0', 'p:villa:1']);
    expect(images.map((i) => i.url)).toEqual([
      `https://now.trycloudflare.com${path}`,
      `https://now.trycloudflare.com${path}`,
    ]);
  });

  it('cannot send a relative picture when no public base is configured', () => {
    const allowlist = new ImageAllowlist(productImages([villa]));
    expect(allowlist.resolve(['p:villa:0']).images).toEqual([]);
    expect(allowlist.resolve(['p:villa:1']).images.map((i) => i.url)).toEqual([
      `https://old.trycloudflare.com${path}`,
    ]);
  });
});
