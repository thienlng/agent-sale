import { CreateFaqRequest, type ImportFaqsRequest } from '@agent-sales/contracts';

export const MAX_FAQ_CSV_BYTES = 1024 * 1024;
export type FaqCsvError = 'size' | 'format' | 'columns' | 'limit' | 'values';
export type FaqCsvResult =
  | { ok: true; items: ImportFaqsRequest['items'] }
  | { ok: false; reason: FaqCsvError; row?: number };

/** RFC-4180-style fields: supports CRLF, quoted commas/newlines and doubled quotes. */
function csvRows(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let state: 'plain' | 'quoted' | 'closed' = 'plain';
  const push = () => {
    row.push(field);
    field = '';
    state = 'plain';
  };
  const finish = () => {
    push();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (state === 'quoted') {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else state = 'closed';
      } else field += character;
      continue;
    }
    if (character === ',') {
      push();
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[i + 1] === '\n') i++;
      finish();
      if (rows.length > 101) return rows;
      continue;
    }
    if (state === 'closed') return null;
    if (character === '"') {
      if (field.length) return null;
      state = 'quoted';
    } else field += character;
  }
  if (state === 'quoted') return null;
  if (field.length || row.length || state === 'closed') finish();
  return rows;
}

export function parseFaqCsv(text: string): FaqCsvResult {
  if (new TextEncoder().encode(text).length > MAX_FAQ_CSV_BYTES)
    return { ok: false, reason: 'size' };
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  if (!rows) return { ok: false, reason: 'format' };
  const header = rows[0];
  if (
    header?.length !== 2 ||
    header[0]?.trim().toLowerCase() !== 'question' ||
    header[1]?.trim().toLowerCase() !== 'answer'
  )
    return { ok: false, reason: 'columns' };
  if (rows.length > 101) return { ok: false, reason: 'limit' };
  if (rows.length < 2) return { ok: false, reason: 'values', row: 2 };
  const items: ImportFaqsRequest['items'] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== 2) return { ok: false, reason: 'columns', row: index + 2 };
    const item = CreateFaqRequest.safeParse({ question: row[0], answer: row[1] });
    if (!item.success) return { ok: false, reason: 'values', row: index + 2 };
    items.push(item.data);
  }
  return { ok: true, items };
}

/** Escape cells before quoting to prevent spreadsheet applications evaluating formulas. */
function csvCell(value: string): string {
  const safe = /^\s*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function formatFaqCsv(items: Array<{ question: string; answer: string }>): string {
  return (
    '\uFEFFquestion,answer\r\n' +
    items.map((item) => `${csvCell(item.question)},${csvCell(item.answer)}`).join('\r\n')
  );
}

export function downloadFaqCsv(
  items: Array<{ question: string; answer: string }>,
  filename: string,
): void {
  const url = URL.createObjectURL(
    new Blob([formatFaqCsv(items)], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
