/**
 * Short, masked samples of an import batch for the turn message (T-173, spec §6.3). Pure.
 */
import type { ImportDraft } from './product-import.schema.js';

/** The 1b safety scanner's phone and e-mail rules (ai-core may not be imported by domain/). */
const PHONE = /(?<!\d)(?:\+84|0)[\s.]?[35789](?:[\s.]?\d){8}(?!\d)/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

function maskCell(value: string, maxCell: number): string {
  if (PHONE.test(value)) return '[phone]';
  if (EMAIL.test(value)) return '[email]';
  return value.length > maxCell ? `${value.slice(0, maxCell)}…` : value;
}

/**
 * The first rows of a sheet as `r<i>: [json cells]` lines, with phone numbers and e-mail
 * addresses masked, long cells cut and trailing empty cells dropped.
 */
export function sheetSample(rows: string[][], maxRows = 10, maxCell = 120): string[] {
  return rows.slice(0, maxRows).map((row, i) => {
    let end = row.length;
    while (end > 0 && (row[end - 1] ?? '').trim() === '') end--;
    const cells = row.slice(0, end).map((c) => maskCell(c, maxCell));
    return `r${i}: ${JSON.stringify(cells)}`;
  });
}

/** One line per photo draft: `p<i>: name / first 200 chars of the description / problems`. */
export function photoSample(drafts: ImportDraft[]): string[] {
  return drafts.map((d) => {
    const name = d.product?.name || '(chưa có tên)';
    const description = (d.product?.description ?? '').replace(/\s+/g, ' ').slice(0, 200);
    const problems = d.problems.map((p) => p.code).join(', ') || 'ok';
    return `${d.key}: ${name} / ${description} / ${problems}`;
  });
}
