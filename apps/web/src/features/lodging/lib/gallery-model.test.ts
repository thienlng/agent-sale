import type { GalleryFolder, GalleryItem } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import {
  addFolder,
  appendItems,
  coverOf,
  deleteFolder,
  folderCounts,
  type GalleryDraft,
  imageNumbers,
  itemKeys,
  moveFolder,
  moveItemsTo,
  remainingItems,
  removeItems,
  renameFolder,
  reorderItems,
  setCover,
} from './gallery-model';

const img = (n: number): GalleryItem => ({
  kind: 'image',
  url: `https://cdn.example.com/${n}.jpg`,
  caption: '',
});
const link: GalleryItem = { kind: 'link', url: 'https://youtu.be/x', caption: '' };
const folder = (id: string, name: string, items: GalleryItem[] = []): GalleryFolder => ({
  id,
  name,
  items,
});
const draft = (gallery: GalleryFolder[], galleryCover = ''): GalleryDraft => ({
  gallery,
  galleryCover,
});

describe('gallery folders', () => {
  it('adds a trimmed folder and refuses a duplicate name, an empty name or a 21st folder', () => {
    const one = addFolder(draft([]), '  Phòng ngủ ', 'a');
    expect(one.gallery).toEqual([folder('a', 'Phòng ngủ')]);
    expect(addFolder(one, 'phòng NGỦ', 'b')).toBe(one);
    expect(addFolder(one, '   ', 'b')).toBe(one);
    const full = draft(Array.from({ length: 20 }, (_, i) => folder(`f${i}`, `F${i}`)));
    expect(addFolder(full, 'Mới', 'x')).toBe(full);
  });

  it('renames unless the name is taken, and moves folders within bounds', () => {
    const d = draft([folder('a', 'A'), folder('b', 'B')]);
    expect(renameFolder(d, 'a', 'b')).toBe(d);
    expect(renameFolder(d, 'a', 'Sân').gallery[0]?.name).toBe('Sân');
    expect(moveFolder(d, 'b', -1).gallery.map((f) => f.id)).toEqual(['b', 'a']);
    expect(moveFolder(d, 'a', -1).gallery.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('clears a chosen cover when its folder or photo goes away', () => {
    const d = draft([folder('a', 'A', [img(1), img(2)]), folder('b', 'B', [img(3)])], img(2).url);
    expect(deleteFolder(d, 'b').galleryCover).toBe(img(2).url);
    expect(deleteFolder(d, 'a').galleryCover).toBe('');
    expect(removeItems(d, 'a', [1]).galleryCover).toBe('');
    expect(coverOf(removeItems(d, 'a', [1]))).toBe(img(1).url);
    expect(setCover(d, img(3).url).galleryCover).toBe(img(3).url);
  });
});

describe('gallery items', () => {
  it('appends up to 200 items for the whole property', () => {
    const d = draft([
      folder(
        'a',
        'A',
        Array.from({ length: 198 }, (_, i) => img(i)),
      ),
    ]);
    expect(remainingItems(d)).toBe(2);
    expect(appendItems(d, 'a', [img(1), img(2), img(3)]).gallery[0]?.items).toHaveLength(200);
  });

  it('reorders, moves selected items to the end of another folder and removes them', () => {
    const d = draft([folder('a', 'A', [img(1), img(2), img(3)]), folder('b', 'B', [img(9)])]);
    expect(reorderItems(d, 'a', 2, 0).gallery[0]?.items.map((i) => i.url)).toEqual([
      img(3).url,
      img(1).url,
      img(2).url,
    ]);
    const moved = moveItemsTo(d, 'a', [0, 2], 'b');
    expect(moved.gallery[0]?.items).toEqual([img(2)]);
    expect(moved.gallery[1]?.items).toEqual([img(9), img(1), img(3)]);
  });

  it('numbers photos only, counts kinds and keys repeated urls apart', () => {
    const items = [
      img(1),
      link,
      img(1),
      { kind: 'video' as const, url: '/media/x.mp4', caption: '' },
    ];
    expect(imageNumbers(items)).toEqual([1, null, 2, null]);
    expect(folderCounts(folder('a', 'A', items))).toEqual({ images: 2, videos: 1, links: 1 });
    expect(itemKeys(items)).toEqual([img(1).url, link.url, `${img(1).url}#1`, '/media/x.mp4']);
  });
});
