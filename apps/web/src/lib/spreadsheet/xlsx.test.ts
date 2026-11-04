import { describe, expect, it } from 'vitest';

import { makeZip, xlsxEntries } from './test-zip';
import { readXlsx, XlsxError } from './xlsx';

const cell = (ref: string, inner: string, type?: string) =>
  `<c r="${ref}"${type ? ` t="${type}"` : ''}>${inner}</c>`;

describe('readXlsx', () => {
  it('reads shared and inline strings, numbers, booleans and errors from the first sheet', async () => {
    const sheet =
      `<row r="1">${cell('A1', '<v>0</v>', 's')}${cell('B1', '<v>1</v>', 's')}${cell('C1', '<v>2</v>', 's')}</row>` +
      `<row r="2">${cell('A2', '<is><t>Áo </t><t>thun</t></is>', 'inlineStr')}${cell('B2', '<v>150000</v>')}${cell('C2', '<v>1</v>', 'b')}</row>` +
      `<row r="3">${cell('A3', '<v>Mũ</v>', 'str')}${cell('B3', '<v>#N/A</v>', 'e')}${cell('C3', '<v>0</v>', 'b')}</row>`;
    const zip = await makeZip(
      xlsxEntries(
        [sheet, `<row r="1">${cell('A1', '<v>9</v>')}</row>`],
        ['Tên', 'Giá', 'Còn hàng'],
      ),
    );
    expect(await readXlsx(zip)).toEqual([
      ['Tên', 'Giá', 'Còn hàng'],
      ['Áo thun', '150000', 'TRUE'],
      ['Mũ', '', 'FALSE'],
    ]);
  });

  it('fills sparse rows and cells with empty strings', async () => {
    const sheet =
      `<row r="1">${cell('A1', '<v>1</v>')}${cell('C1', '<v>3</v>')}</row>` +
      `<row r="3">${cell('B3', '<v>x</v>', 'str')}</row>`;
    const zip = await makeZip(xlsxEntries([sheet]));
    expect(await readXlsx(zip)).toEqual([
      ['1', '', '3'],
      ['', '', ''],
      ['', 'x', ''],
    ]);
  });

  it('reads stored (uncompressed) entries too', async () => {
    const entries = xlsxEntries([`<row r="1">${cell('A1', '<v>7</v>')}</row>`]).map((e) => ({
      ...e,
      method: 0 as const,
    }));
    expect(await readXlsx(await makeZip(entries))).toEqual([['7']]);
  });

  it('stops inflating past the budget (zip bomb)', async () => {
    const huge = new Uint8Array(40 * 1024 * 1024).fill(0x20);
    const entries = xlsxEntries(['']);
    const zip = await makeZip([
      ...entries.filter((e) => !e.name.startsWith('xl/worksheets/')),
      { name: 'xl/worksheets/sheet1.xml', data: huge },
    ]);
    const error = await readXlsx(zip).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XlsxError);
    expect((error as XlsxError).reason).toBe('too_large');
    // Building the 40 MB fixture is the slow part on a busy machine.
  }, 60_000);

  it('refuses something that is not a zip', async () => {
    await expect(readXlsx(new TextEncoder().encode('not a zip at all'))).rejects.toMatchObject({
      reason: 'format',
    });
  });
});
