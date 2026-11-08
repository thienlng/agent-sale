import { readFileSync } from 'node:fs';

import type { ExportCell, ExportTable } from '@agent-sales/contracts';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ZipArchiveWriter } from '../infrastructure/archive/zip-archive-writer.js';
import { mediaKey } from '../infrastructure/storage/s3-export-storage.js';

function table(
  file: string,
  columns: string[],
  pages: ExportCell[][][],
  media?: string[],
): ExportTable {
  return {
    file,
    columns,
    ...(media ? { mediaColumns: media } : {}),
    async *rows() {
      for (const p of pages) yield p;
    },
  };
}

const KEY =
  'products/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';

async function* bytes(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

describe('ZipArchiveWriter', () => {
  const media = {
    readMedia: async (url: string) => {
      const key = mediaKey(url);
      return key === KEY ? { key, body: bytes('JPEGDATA') } : null;
    },
  };

  it('writes one CSV per table with BOM and header, pages in order, then README', async () => {
    const out = await new ZipArchiveWriter(media).write({
      tables: [
        table('customers.csv', ['id', 'name'], [[['1', 'An, B']], [['2', '=cmd']]]),
        table('empty.csv', ['id'], []),
      ],
      includeMedia: false,
      readme: (c) => `rows=${JSON.stringify(c.rows)}`,
    });
    const files = unzipSync(readFileSync(out.path));
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'customers.csv', 'empty.csv']);
    // UTF-8 BOM bytes first (TextDecoder hides them in the decoded text).
    expect([...files['customers.csv']!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(strFromU8(files['customers.csv']!).replace(/^\uFEFF/, '')).toBe(
      'id,name\r\n1,"An, B"\r\n2,\'=cmd\r\n',
    );
    expect(strFromU8(files['empty.csv']!).replace(/^\uFEFF/, '')).toBe('id\r\n');
    expect(strFromU8(files['README.txt']!)).toContain('"customers.csv":2');
    expect(out.counts.rows).toEqual({ 'customers.csv': 2, 'empty.csv': 0 });
    expect(out.sizeBytes).toBeGreaterThan(0);
    await out.cleanup();
  });

  it('copies Rapiz media once under media/ and counts links it cannot copy', async () => {
    const out = await new ZipArchiveWriter(media).write({
      tables: [
        table(
          'products.csv',
          ['id', 'image_urls'],
          [
            [
              ['1', [`/media/${KEY}`, 'https://cdn.example.com/x.jpg']],
              ['2', `https://rapiz.io/media/${KEY}`],
            ],
          ],
          ['image_urls'],
        ),
      ],
      includeMedia: true,
      readme: () => 'r',
    });
    const files = unzipSync(readFileSync(out.path));
    expect(strFromU8(files[`media/${KEY}`]!)).toBe('JPEGDATA');
    expect(out.counts).toMatchObject({ mediaFiles: 1, mediaSkipped: 1 });
    await out.cleanup();
  });

  it('leaves media out unless asked', async () => {
    const out = await new ZipArchiveWriter(media).write({
      tables: [
        table('products.csv', ['id', 'image_urls'], [[['1', `/media/${KEY}`]]], ['image_urls']),
      ],
      includeMedia: false,
      readme: () => 'r',
    });
    expect(Object.keys(unzipSync(readFileSync(out.path)))).not.toContain(`media/${KEY}`);
    await out.cleanup();
  });

  it('removes the temp file when a table fails', async () => {
    const broken: ExportTable = {
      file: 'x.csv',
      columns: ['a'],
      rows: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('db down')) }),
      }),
    };
    await expect(
      new ZipArchiveWriter(media).write({
        tables: [broken],
        includeMedia: false,
        readme: () => '',
      }),
    ).rejects.toThrow('db down');
  });
});

describe('mediaKey', () => {
  it('accepts public URLs, /media paths and bare keys of Rapiz objects only', () => {
    expect(mediaKey(`https://rapiz.io/media/${KEY}`)).toBe(KEY);
    expect(mediaKey(`/media/${KEY}`)).toBe(KEY);
    expect(mediaKey(KEY)).toBe(KEY);
    expect(mediaKey('https://scontent.fbcdn.net/x.jpg')).toBeNull();
    expect(mediaKey('/media/../etc/passwd')).toBeNull();
  });
});

describe('media in nested JSON', () => {
  it('finds Rapiz objects inside gallery folders and skips plain text', async () => {
    const reads: string[] = [];
    const media = {
      readMedia: async (url: string) => {
        reads.push(url);
        const key = mediaKey(url);
        return key === KEY ? { key, body: bytes('IMG') } : null;
      },
    };
    const gallery = [{ title: 'Phòng ngủ', items: [{ kind: 'photo', url: `/media/${KEY}` }] }];
    const out = await new ZipArchiveWriter(media).write({
      tables: [table('lodging_units.csv', ['id', 'gallery'], [[['1', gallery]]], ['gallery'])],
      includeMedia: true,
      readme: () => 'r',
    });
    expect(Object.keys(unzipSync(readFileSync(out.path)))).toContain(`media/${KEY}`);
    expect(reads).toEqual([`/media/${KEY}`]);
    await out.cleanup();
  });
});
