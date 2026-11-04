/**
 * CSV for the assistant's product import (T-173, C4-R3): RFC 4180 quoting (quoted delimiters,
 * newlines and doubled quotes), the delimiter sniffed from the first non-empty line (`,` `;` or
 * tab), a UTF-8 BOM stripped, and a windows-1258 retry for Vietnamese Excel exports on Windows.
 */

const DELIMITERS = [',', ';', '\t'] as const;
export type CsvDelimiter = (typeof DELIMITERS)[number];

/** The most frequent of `,` `;` and tab outside quotes on the first non-empty line (`,` on a tie). */
export function sniffDelimiter(text: string): CsvDelimiter {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let seen = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (seen) break;
    } else if (!quoted && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
    if (c.trim() !== '') seen = true;
  }
  let best: CsvDelimiter = ',';
  for (const d of DELIMITERS) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  return best;
}

/**
 * Every row of the text (blank rows kept, so row numbers match the file), as written. A quote in
 * the middle of an unquoted field is kept as a character, never an error.
 */
export function csvRows(text: string, delimiter: string = sniffDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atStart = true;
  const endField = () => {
    row.push(field);
    field = '';
    atStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (c === delimiter) endField();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
      atStart = false;
    }
  }
  if (field !== '' || row.length > 0 || !atStart) endRow();
  return rows;
}

/**
 * Decodes CSV bytes: UTF-8 (BOM stripped); when the text has replacement characters and the file
 * has no BOM, windows-1258 (Vietnamese Excel's "CSV" on Windows).
 */
export function decodeCsv(bytes: Uint8Array): string {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const utf8 = new TextDecoder('utf-8').decode(bom ? bytes.subarray(3) : bytes);
  if (bom || !utf8.includes('\uFFFD')) return utf8.replace(/^\uFEFF/, '');
  try {
    return new TextDecoder('windows-1258').decode(bytes).normalize('NFC');
  } catch {
    return utf8;
  }
}

export function readCsv(bytes: Uint8Array): string[][] {
  return csvRows(decodeCsv(bytes));
}
