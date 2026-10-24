import { describe, expect, it } from 'vitest';
import { formatFaqCsv, MAX_FAQ_CSV_BYTES, parseFaqCsv } from './faq-csv';

describe('FAQ CSV', () => {
  it('parses BOM, CRLF, quoted commas/newlines and doubled quotes', () => {
    expect(
      parseFaqCsv('\uFEFFquestion,answer\r\n"What, exactly?","Line one\nLine ""two"""\r\n'),
    ).toEqual({
      ok: true,
      items: [{ question: 'What, exactly?', answer: 'Line one\nLine "two"' }],
    });
  });
  it('rejects malformed fields, columns, invalid values, oversized files and too many rows', () => {
    expect(parseFaqCsv('question,answer\n"Unfinished,answer')).toMatchObject({
      ok: false,
      reason: 'format',
    });
    expect(parseFaqCsv('question,answer\n"Question"oops,answer')).toMatchObject({
      ok: false,
      reason: 'format',
    });
    expect(parseFaqCsv('title,answer\nQuestion,Answer')).toMatchObject({
      ok: false,
      reason: 'columns',
    });
    expect(parseFaqCsv('question,answer\nQuestion,Answer,Extra')).toMatchObject({
      ok: false,
      reason: 'columns',
      row: 2,
    });
    expect(parseFaqCsv('question,answer\nQ,Answer')).toMatchObject({
      ok: false,
      reason: 'values',
      row: 2,
    });
    expect(parseFaqCsv('x'.repeat(MAX_FAQ_CSV_BYTES + 1))).toMatchObject({
      ok: false,
      reason: 'size',
    });
    expect(parseFaqCsv('question,answer\n' + 'Question,Answer\n'.repeat(101))).toMatchObject({
      ok: false,
      reason: 'limit',
    });
  });
  it('exports spreadsheet-safe formulas and preserves ordinary quoted/newline text', () => {
    const csv = formatFaqCsv([
      { question: '=HYPERLINK("bad")', answer: '  +SUM(1,2)' },
      { question: '@command', answer: '\tunsafe' },
      { question: 'Return policy?', answer: 'First line\n"Second line"' },
    ]);
    const parsed = parseFaqCsv(csv);
    expect(parsed.ok && parsed.items).toEqual([
      { question: '\'=HYPERLINK("bad")', answer: "'  +SUM(1,2)" },
      { question: "'@command", answer: "'\tunsafe" },
      { question: 'Return policy?', answer: 'First line\n"Second line"' },
    ]);
  });
});
