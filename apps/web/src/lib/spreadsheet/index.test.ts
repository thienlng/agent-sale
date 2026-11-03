import { describe, expect, it } from 'vitest';

import { readSpreadsheet, trimRows } from './index';
import { makeZip, xlsxEntries } from './test-zip';

const file = (parts: BlobPart[], name: string, type = '') => new File(parts, name, { type });

describe('trimRows', () => {
  it('drops trailing empty rows and columns and pads short rows', () => {
    expect(
      trimRows([
        ['a', '', ''],
        ['b', 'c'],
        ['', ' '],
      ]),
    ).toEqual([
      ['a', ''],
      ['b', 'c'],
    ]);
  });
});

describe('readSpreadsheet', () => {
  it('reads a CSV with ; and a BOM', async () => {
    const out = await readSpreadsheet(file(['\uFEFFTên;Giá\nÁo;150k\n;\n'], 'hang.csv'));
    expect(out).toEqual({
      rows: [
        ['Tên', 'Giá'],
        ['Áo', '150k'],
      ],
    });
  });

  it('reads an xlsx by its magic bytes', async () => {
    const zip = await makeZip(xlsxEntries(['<row r="1"><c r="A1" t="str"><v>Tên</v></c></row>']));
    expect(await readSpreadsheet(file([zip as Uint8Array<ArrayBuffer>], 'hang.xlsx'))).toEqual({
      rows: [['Tên']],
    });
  });

  it('refuses legacy .xls and .ods files', async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await readSpreadsheet(file([xls], 'cu.xls'))).toEqual({ error: 'legacy_xls' });
    expect(await readSpreadsheet(file(['x'], 'bang.ods'))).toEqual({ error: 'legacy_xls' });
  });

  it('refuses empty and too large sheets', async () => {
    expect(await readSpreadsheet(file([' ,\n,\n'], 'trong.csv'))).toEqual({ error: 'empty' });
    const tall = Array.from({ length: 320 }, (_, i) => `SP ${i},1`).join('\n');
    expect(await readSpreadsheet(file([tall], 'dai.csv'))).toEqual({ error: 'too_large' });
    const wide = Array.from({ length: 41 }, (_, i) => `c${i}`).join(',');
    expect(await readSpreadsheet(file([wide], 'rong.csv'))).toEqual({ error: 'too_large' });
    expect(await readSpreadsheet(file(['a'.repeat(1001)], 'o.csv'))).toEqual({
      error: 'too_large',
    });
    const big = { size: 6 * 1024 * 1024, name: 'to.csv' } as File;
    expect(await readSpreadsheet(big)).toEqual({ error: 'too_large' });
  });

  it('counts the size in UTF-8 bytes, not characters', async () => {
    // 600 000 characters but 1.8 MB: Vietnamese letters such as ệ take 3 bytes each.
    const cell = 'ệ'.repeat(1000);
    const rows = Array.from({ length: 300 }, () => `${cell},${cell}`).join('\n');
    expect(await readSpreadsheet(file([rows], 'dau.csv'))).toEqual({ error: 'too_large' });
  });

  it('refuses an unknown format', async () => {
    expect(await readSpreadsheet(file(['hello'], 'a.txt'))).toEqual({ error: 'format' });
  });
});
