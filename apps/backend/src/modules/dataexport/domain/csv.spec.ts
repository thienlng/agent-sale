import { describe, expect, it } from 'vitest';

import { csvCell, csvLine } from './csv.js';
import { exportFileName } from './data-export.js';

describe('csvCell', () => {
  it('writes plain values as they are and empty for null', () => {
    expect(csvCell('Nguyễn Văn A')).toBe('Nguyễn Văn A');
    expect(csvCell(150000)).toBe('150000');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('writes dates as ISO and objects as JSON', () => {
    expect(csvCell(new Date('2026-11-08T01:02:03Z'))).toBe('2026-11-08T01:02:03.000Z');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(['x'])).toBe('"[""x""]"');
  });

  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2+3+cmd')).toBe("'-2+3+cmd");
    expect(csvCell('\tx')).toBe("'\tx");
  });

  it('keeps phones and signed numbers readable', () => {
    expect(csvCell('+84 912 345 678')).toBe('+84 912 345 678');
    expect(csvCell('-15000')).toBe('-15000');
    expect(csvCell('(028) 3822 1234')).toBe('(028) 3822 1234');
  });
});

describe('csvLine', () => {
  it('joins cells with commas and ends with CRLF', () => {
    expect(csvLine(['a', 1, null])).toBe('a,1,\r\n');
  });
});

describe('exportFileName', () => {
  it('slugs the business name without Vietnamese marks', () => {
    expect(exportFileName('Tam Đảo Villas Central', new Date('2026-11-08T10:00:00Z'))).toBe(
      'rapiz-tam-dao-villas-central-2026-11-08.zip',
    );
    expect(exportFileName('!!!', new Date('2026-11-08T10:00:00Z'))).toBe(
      'rapiz-business-2026-11-08.zip',
    );
  });
});
