import { describe, expect, it } from 'vitest';

import { csvRows, decodeCsv, readCsv, sniffDelimiter } from './csv';

describe('sniffDelimiter', () => {
  it('picks the most frequent delimiter of the first non-empty line, outside quotes', () => {
    expect(sniffDelimiter('a,b,c\n1;2')).toBe(',');
    expect(sniffDelimiter('\n\nTên;Giá;Mã\n')).toBe(';');
    expect(sniffDelimiter('Tên\tGiá\n')).toBe('\t');
    expect(sniffDelimiter('"a;b;c",d\n')).toBe(',');
    expect(sniffDelimiter('one column\n')).toBe(',');
  });
});

describe('csvRows', () => {
  it('reads ; and tab delimited text', () => {
    expect(csvRows('Tên;Giá\nÁo;150.000')).toEqual([
      ['Tên', 'Giá'],
      ['Áo', '150.000'],
    ]);
    expect(csvRows('Tên\tGiá\r\nÁo\t150k\r\n')).toEqual([
      ['Tên', 'Giá'],
      ['Áo', '150k'],
    ]);
  });

  it('keeps quoted delimiters, newlines and doubled quotes, and blank rows', () => {
    expect(csvRows('a,"b, c","line 1\nline 2"\n\n"say ""hi""",x')).toEqual([
      ['a', 'b, c', 'line 1\nline 2'],
      [''],
      ['say "hi"', 'x'],
    ]);
  });

  it('keeps a stray quote inside an unquoted field', () => {
    expect(csvRows('5" phone,ok')).toEqual([['5" phone', 'ok']]);
  });
});

describe('decodeCsv', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Tên,Giá')]);
    expect(decodeCsv(bytes)).toBe('Tên,Giá');
    expect(readCsv(bytes)).toEqual([['Tên', 'Giá']]);
  });

  it('falls back to windows-1258 for a Vietnamese Excel export without BOM', () => {
    // "Áo" in windows-1258: Á = 0xC1, o = 0x6F; "Giá" = G i 0xE1.
    const bytes = new Uint8Array([0xc1, 0x6f, 0x2c, 0x47, 0x69, 0xe1]);
    expect(decodeCsv(bytes)).toBe('Áo,Giá');
  });
});
