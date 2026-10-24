import { describe, expect, it } from 'vitest';

import {
  bytesToBase64,
  imageFileError,
  MAX_IMAGE_BYTES,
  summarizeLibrary,
  titleFromFileName,
  UNCATEGORIZED,
  visibleFolders,
} from './media-library';
import { trainingItem } from './test-items';

describe('summarizeLibrary', () => {
  const shoes = trainingItem({
    kind: 'media_folder',
    title: 'Giày',
    createdAt: '2026-02-01T00:00:00.000Z',
  });
  const bags = trainingItem({
    kind: 'media_folder',
    title: 'Balo',
    createdAt: '2026-03-01T00:00:00.000Z',
  });
  const items = [
    shoes,
    bags,
    trainingItem({ folderId: shoes.id, mediaUrl: 'https://cdn.test/1.png' }),
    trainingItem({ folderId: shoes.id, mediaUrl: 'https://cdn.test/2.png' }),
    trainingItem({ folderId: null, mediaUrl: 'https://cdn.test/3.png' }),
    // Folder deleted elsewhere: the image is shown as uncategorized instead of vanishing.
    trainingItem({ folderId: '00000000-0000-4000-8000-0000000000aa' }),
    trainingItem({ kind: 'quick_reply', title: 'hi' }),
  ];

  it('counts images per folder and collects the loose ones', () => {
    const library = summarizeLibrary(items);
    expect(library.imageCount).toBe(4);
    expect(library.folders.map((f) => [f.name, f.images.length])).toEqual([
      ['Giày', 2],
      ['Balo', 0],
    ]);
    expect(library.uncategorized?.id).toBe(UNCATEGORIZED);
    expect(library.uncategorized?.images).toHaveLength(2);
  });

  it('has no uncategorized folder when every image is filed', () => {
    expect(summarizeLibrary([shoes, items[2]!]).uncategorized).toBeNull();
  });

  it('searches and sorts folders', () => {
    const { folders } = summarizeLibrary(items);
    expect(visibleFolders(folders, '', 'newest').map((f) => f.name)).toEqual(['Balo', 'Giày']);
    expect(visibleFolders(folders, '', 'oldest').map((f) => f.name)).toEqual(['Giày', 'Balo']);
    expect(visibleFolders(folders, '', 'name').map((f) => f.name)).toEqual(['Balo', 'Giày']);
    expect(visibleFolders(folders, 'giay', 'name').map((f) => f.name)).toEqual(['Giày']);
  });
});

describe('image files', () => {
  it('accepts PNG/JPEG/WebP up to 1 MB', () => {
    expect(imageFileError({ type: 'image/png', size: 10 })).toBeNull();
    expect(imageFileError({ type: 'image/webp', size: MAX_IMAGE_BYTES })).toBeNull();
    expect(imageFileError({ type: 'image/gif', size: 10 })).toBe('fileType');
    expect(imageFileError({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 })).toBe('fileSize');
  });

  it('derives a title from the file name', () => {
    expect(titleFromFileName('ao-thun.trang.jpg')).toBe('ao-thun.trang');
    expect(titleFromFileName('.png')).toBe('.png');
  });

  it('encodes bytes as plain base64', () => {
    expect(bytesToBase64(new Uint8Array([104, 105, 255]))).toBe('aGn/');
    const big = new Uint8Array(0x8000 * 2 + 3).fill(65);
    expect(atob(bytesToBase64(big))).toBe('A'.repeat(big.length));
  });
});
