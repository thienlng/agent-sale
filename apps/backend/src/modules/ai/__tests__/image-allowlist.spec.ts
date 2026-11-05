import { describe, expect, it } from 'vitest';

import {
  buildAllowlist,
  imagesBlock,
  libraryImages,
  MAX_PRODUCT_ALBUMS,
  MAX_PRODUCT_VIDEOS,
  nextAlbumPage,
  productAlbums,
  productIdOfImage,
  productImages,
  productVideos,
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

  it('leaves a look-alike external /media/ link alone and ignores a look-alike path', () => {
    const lookAlike = 'https://cdn.shop.vn/media/products/villa-1.jpg';
    const images = productImages([
      { id: 'shop', name: 'Shop', imageUrls: [lookAlike, '/media/products/villa-1.jpg'] },
    ]);
    expect(images.map((i) => i.url)).toEqual([lookAlike]);
    const allowlist = new ImageAllowlist(images, 'https://now.trycloudflare.com/media');
    expect(allowlist.resolve(['p:shop:0']).images.map((i) => i.url)).toEqual([lookAlike]);
  });

  it('cannot send a relative picture when no public base is configured', () => {
    const allowlist = new ImageAllowlist(productImages([villa]));
    expect(allowlist.resolve(['p:villa:0']).images).toEqual([]);
    expect(allowlist.resolve(['p:villa:1']).images.map((i) => i.url)).toEqual([
      `https://old.trycloudflare.com${path}`,
    ]);
  });
});

const WS = '0192f0a0-0000-7000-8000-000000000001';
const CLIP = `/media/lodging/${WS}/0192f0a0-0000-7000-8000-0000000000cc.mp4`;
const villa = {
  id: 'villa-1',
  name: 'A17 – Villa',
  accommodation: {
    albums: [
      {
        name: 'Ngoài trời',
        items: [
          { kind: 'image', url: 'https://cdn.example.com/o1.jpg', caption: 'Hồ bơi' },
          { kind: 'image', url: 'http://insecure.example/x.jpg', caption: '' },
          { kind: 'link', url: 'https://youtu.be/flycam', caption: '' },
        ],
      },
      { name: 'Video', items: [{ kind: 'video', url: CLIP, caption: 'Giới thiệu' }] },
      {
        name: 'Phòng ngủ',
        items: Array.from({ length: 12 }, (_, i) => ({
          kind: 'image',
          url: `https://cdn.example.com/b${i}.jpg`,
          caption: '',
        })),
      },
    ],
  },
};

describe('lodging albums and videos', () => {
  it('lists one album per folder that has sendable photos, with its photo count', () => {
    const albums = productAlbums([villa]);
    expect(albums.map((a) => [a.id, a.label, a.images.length])).toEqual([
      ['a:villa-1:0', 'A17 – Villa – Ngoài trời (1 ảnh)', 1],
      ['a:villa-1:2', 'A17 – Villa – Phòng ngủ (12 ảnh)', 12],
    ]);
    expect(albums[0]?.images[0]).toEqual({
      url: 'https://cdn.example.com/o1.jpg',
      label: 'A17 – Villa – Hồ bơi',
    });
    expect(albums[1]?.images[0]?.label).toBe('A17 – Villa – Phòng ngủ');
  });

  it('lists uploaded videos and links with their folder, numbered per folder when untitled', () => {
    expect(productVideos([villa]).map((v) => [v.id, v.kind, v.label])).toEqual([
      ['v:villa-1:0:2', 'link', 'A17 – Villa – Ngoài trời – video: video 1'],
      ['v:villa-1:1:0', 'video', 'A17 – Villa – Video – video: Giới thiệu'],
    ]);
  });

  it('caps albums at 20 and videos at 10 per product, and ignores products without albums', () => {
    const many = {
      id: 'm',
      name: 'M',
      accommodation: {
        albums: Array.from({ length: 25 }, (_, f) => ({
          name: `F${f}`,
          items: [
            { kind: 'image', url: `https://cdn.example.com/${f}.jpg`, caption: '' },
            { kind: 'link', url: `https://youtu.be/${f}`, caption: '' },
          ],
        })),
      },
    };
    expect(productAlbums([many])).toHaveLength(MAX_PRODUCT_ALBUMS);
    expect(productVideos([many])).toHaveLength(MAX_PRODUCT_VIDEOS);
    expect(productAlbums([product])).toEqual([]);
  });

  it("lists each unit's own folders and videos after the property's, ids unique (T-193)", () => {
    const resort = {
      id: 'resort',
      name: 'R01 – Resort Đồi',
      accommodation: {
        albums: [
          {
            name: 'Khuôn viên',
            items: [{ kind: 'image', url: 'https://cdn.example.com/k.jpg', caption: '' }],
          },
        ],
        units: [
          {
            name: 'Bungalow 1',
            albums: [
              {
                name: 'View đồi',
                items: [
                  { kind: 'image', url: 'https://cdn.example.com/b1-0.jpg', caption: '' },
                  { kind: 'image', url: 'https://cdn.example.com/b1-1.jpg', caption: 'Ban công' },
                ],
              },
            ],
          },
          { name: 'Bungalow 2' },
          {
            name: 'Bungalow 3',
            albums: [
              { name: 'Clip', items: [{ kind: 'video', url: CLIP, caption: '' }] },
              {
                name: 'Phòng',
                items: [{ kind: 'image', url: 'https://cdn.example.com/b3.jpg', caption: '' }],
              },
            ],
          },
        ],
      },
    };
    const albums = productAlbums([resort]);
    expect(albums.map((a) => [a.id, a.label])).toEqual([
      ['a:resort:0', 'R01 – Resort Đồi – Khuôn viên (1 ảnh)'],
      [`a:resort:${MAX_PRODUCT_ALBUMS}`, 'R01 – Resort Đồi – Bungalow 1 – View đồi (2 ảnh)'],
      [`a:resort:${MAX_PRODUCT_ALBUMS + 2}`, 'R01 – Resort Đồi – Bungalow 3 – Phòng (1 ảnh)'],
    ]);
    expect(albums[1]?.images.map((i) => i.label)).toEqual([
      'R01 – Resort Đồi – Bungalow 1 – View đồi',
      'R01 – Resort Đồi – Bungalow 1 – Ban công',
    ]);
    expect(productVideos([resort]).map((v) => [v.id, v.label])).toEqual([
      [
        `v:resort:${MAX_PRODUCT_ALBUMS + 1}:0`,
        'R01 – Resort Đồi – Bungalow 3 – Clip – video: video 1',
      ],
    ]);
    expect(productIdOfImage(`a:resort:${MAX_PRODUCT_ALBUMS + 2}`)).toBe('resort');
    // send_message resolves a unit folder like a property folder.
    const allowlist = new ImageAllowlist([], 'https://rapiz.test');
    allowlist.addMedia([resort as never]);
    expect(allowlist.album(`a:resort:${MAX_PRODUCT_ALBUMS}`)?.images).toHaveLength(2);
    expect(allowlist.video(`v:resort:${MAX_PRODUCT_ALBUMS + 1}:0`)).toBeDefined();
  });

  it('pages a folder 8 at a time, skipping what was sent, then starts again', () => {
    const sent = (n: number, total = 12) => Array.from({ length: total }, (_, i) => i < n);
    expect(nextAlbumPage(sent(0))).toEqual({
      indexes: [0, 1, 2, 3, 4, 5, 6, 7],
      remaining: 4,
      restarted: false,
    });
    expect(nextAlbumPage(sent(8))).toEqual({
      indexes: [8, 9, 10, 11],
      remaining: 0,
      restarted: false,
    });
    expect(nextAlbumPage(sent(12))).toEqual({
      indexes: [0, 1, 2, 3, 4, 5, 6, 7],
      remaining: 4,
      restarted: true,
    });
    expect(nextAlbumPage([false, true, false])).toEqual({
      indexes: [0, 2],
      remaining: 0,
      restarted: false,
    });
  });

  it('finds the product of album and video ids', () => {
    expect(productIdOfImage('a:villa-1:2:5')).toBe('villa-1');
    expect(productIdOfImage('v:villa-1:0:2')).toBe('villa-1');
    expect(productIdOfImage('p:villa-1:3')).toBe('villa-1');
    expect(productIdOfImage('m:size')).toBeNull();
  });

  it('never lists a stored lodging video as an image', () => {
    const mislabelled = {
      id: 'v2',
      name: 'V2',
      accommodation: {
        albums: [
          {
            name: 'Mixed',
            items: [
              { kind: 'image', url: CLIP, caption: '' },
              { kind: 'image', url: 'https://cdn.example.com/ok.jpg', caption: '' },
            ],
          },
        ],
      },
    };
    expect(productAlbums([mislabelled])[0]?.images.map((i) => i.url)).toEqual([
      'https://cdn.example.com/ok.jpg',
    ]);
    const flat = productImages([
      { id: 'v3', name: 'V3', accommodation: { gallery: [{ url: CLIP, caption: 'clip' }] } },
      { id: 'r1', name: 'R1', imageUrls: [CLIP, 'https://cdn.example.com/r.jpg'] },
    ]);
    expect(flat.map((i) => i.url)).toEqual(['https://cdn.example.com/r.jpg']);
    const library = libraryImages(
      [{ id: '1', kind: 'media', title: 'Hành lang', trigger: '', mediaUrl: CLIP }],
      'ảnh hành lang',
    );
    expect(library).toEqual([]);
  });
});
