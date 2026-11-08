/**
 * CSV of the data export (RFC 4180, CRLF rows, UTF-8 with BOM so Excel shows Vietnamese).
 * Text a spreadsheet would run as a formula (`=`, `@`, a leading tab/CR, or `+`/`-` not followed
 * by a plain number such as a phone) is prefixed with `'` (CSV injection).
 */
export const CSV_BOM = '\uFEFF';

const NUMBERISH = /^[+-][\d\s().]*$/;

export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  else text = JSON.stringify(value);
  if (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !NUMBERISH.test(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: readonly unknown[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}
