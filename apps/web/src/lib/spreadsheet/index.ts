import {
  IMPORT_MAX_CELL_CHARS,
  IMPORT_MAX_SHEET_COLUMNS,
  IMPORT_MAX_SHEET_JSON_BYTES,
  IMPORT_MAX_SHEET_ROWS,
  sheetJsonBytes,
} from '@agent-sales/contracts';

import { readCsv } from './csv';
import { readXlsx, XlsxError } from './xlsx';

/** The largest file the assistant reads (spec §3.1). */
export const SPREADSHEET_MAX_BYTES = 5 * 1024 * 1024;

export type SpreadsheetError = 'format' | 'too_large' | 'legacy_xls' | 'empty';
export type SpreadsheetResult = { rows: string[][] } | { error: SpreadsheetError };

/** Whether a dropped file is a sheet the import may read (by name; the bytes decide later). */
export function isSpreadsheetName(name: string): boolean {
  return /\.(xlsx|csv|xls|ods)$/i.test(name);
}

/** Trailing empty rows and columns removed. */
export function trimRows(rows: string[][]): string[][] {
  const filled = (c: string | undefined) => (c ?? '').trim() !== '';
  let last = rows.length - 1;
  while (last >= 0 && !(rows[last] ?? []).some(filled)) last--;
  const kept = rows.slice(0, last + 1);
  let width = 0;
  for (const row of kept) {
    for (let i = row.length - 1; i >= width; i--) {
      if (filled(row[i])) {
        width = i + 1;
        break;
      }
    }
  }
  return kept.map((row) => {
    const cut = row.slice(0, width);
    while (cut.length < width) cut.push('');
    return cut;
  });
}

async function bytesOf(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/**
 * Reads the first sheet of an `.xlsx` or `.csv` file in the browser (C4-R3). `.xls` (BIFF) and
 * `.ods` are `legacy_xls` (save as .xlsx or .csv). Anything over the import limits (5 MB, 310
 * rows, 40 columns, 1 000 chars per cell, 1.5 MB as JSON) is `too_large`.
 */
export async function readSpreadsheet(file: File): Promise<SpreadsheetResult> {
  if (file.size > SPREADSHEET_MAX_BYTES) return { error: 'too_large' };
  const bytes = await bytesOf(file);
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]) || /\.(xls|ods)$/i.test(file.name)) {
    return { error: 'legacy_xls' };
  }
  let rows: string[][];
  try {
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) rows = await readXlsx(bytes);
    else if (/\.csv$/i.test(file.name) || file.type === 'text/csv') rows = readCsv(bytes);
    else return { error: 'format' };
  } catch (error) {
    if (error instanceof XlsxError) return { error: error.reason };
    return { error: 'format' };
  }
  const trimmed = trimRows(rows);
  if (!trimmed.some((r) => r.some((c) => c.trim() !== ''))) return { error: 'empty' };
  if (
    trimmed.length > IMPORT_MAX_SHEET_ROWS ||
    (trimmed[0]?.length ?? 0) > IMPORT_MAX_SHEET_COLUMNS ||
    trimmed.some((r) => r.some((c) => c.length > IMPORT_MAX_CELL_CHARS)) ||
    sheetJsonBytes(trimmed) > IMPORT_MAX_SHEET_JSON_BYTES
  ) {
    return { error: 'too_large' };
  }
  return { rows: trimmed };
}
