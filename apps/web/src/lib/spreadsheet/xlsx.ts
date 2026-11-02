/**
 * A small `.xlsx` reader for the assistant's product import (T-173, C4-R3): the zip central
 * directory, native `DecompressionStream('deflate-raw')`, `DOMParser` for the workbook, its
 * relationships, the shared strings and the first worksheet. Values only (no styles, formulas or
 * dates as dates). No dependency.
 */

/** Inflated bytes allowed across every entry read (zip-bomb guard). */
export const XLSX_INFLATE_BUDGET = 30 * 1024 * 1024;
export const XLSX_MAX_ENTRIES = 2_000;
export const XLSX_MAX_SHARED_STRINGS = 200_000;
/** A value further down or right than this is far past the import's limits. */
const MAX_ROW_INDEX = 10_000;
const MAX_COLUMN_INDEX = 1_000;

export class XlsxError extends Error {
  constructor(readonly reason: 'format' | 'too_large') {
    super(reason);
    this.name = 'XlsxError';
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function centralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('format');
  const count = view.getUint16(eocd + 10, true);
  if (count > XLSX_MAX_ENTRIES) throw new XlsxError('too_large');
  let at = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) {
      throw new XlsxError('format');
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      name,
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Reads entries, inflating them within one shared budget. */
class ZipReader {
  #used = 0;
  readonly #entries: Map<string, ZipEntry>;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly budget: number,
  ) {
    this.#entries = centralDirectory(bytes);
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  async text(name: string): Promise<string | null> {
    const entry = this.#entries.get(name);
    if (!entry) return null;
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const at = entry.localOffset;
    if (at + 30 > this.bytes.length || view.getUint32(at, true) !== LOCAL) {
      throw new XlsxError('format');
    }
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const data = this.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) {
      this.#charge(data.length);
      return new TextDecoder().decode(data);
    }
    if (entry.method !== 8) throw new XlsxError('format');
    return new TextDecoder().decode(await this.#inflate(data));
  }

  #charge(n: number): void {
    this.#used += n;
    if (this.#used > this.budget) throw new XlsxError('too_large');
  }

  async #inflate(data: Uint8Array): Promise<Uint8Array> {
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    // Errors surface on the reader; these promises must not go unhandled.
    writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
    writer.close().catch(() => undefined);
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        this.#charge(value.length);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error instanceof XlsxError ? error : new XlsxError('format');
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new XlsxError('format');
  return doc;
}

const byLocalName = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagNameNS('*', name));

/** Children of `el` with this local name (not deeper descendants). */
const childrenNamed = (el: Element, name: string): Element[] =>
  Array.from(el.children).filter((c) => c.localName === name);

/** The text of every `t` under `el`, phonetic runs (`rPh`) left out. */
function runText(el: Element): string {
  return byLocalName(el, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

/** `B3` → column 1 (0-based); null when there is no reference. */
function columnOf(ref: string | null): number | null {
  const letters = /^([A-Z]+)/i.exec(ref ?? '')?.[1];
  if (!letters) return null;
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col - 1;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

/** The path of the workbook's first sheet. */
async function firstSheetPath(zip: ZipReader): Promise<string> {
  const workbook = await zip.text('xl/workbook.xml');
  const rels = await zip.text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new XlsxError('format');
  const sheet = byLocalName(parseXml(workbook), 'sheet')[0];
  const rid = sheet
    ? Array.from(sheet.attributes).find((a) => a.localName === 'id' && a.name !== 'sheetId')?.value
    : undefined;
  const rel = byLocalName(parseXml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid);
  const target = rel?.getAttribute('Target');
  if (target) return resolveTarget(target);
  if (zip.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  throw new XlsxError('format');
}

async function sharedStrings(zip: ZipReader): Promise<string[]> {
  const text = await zip.text('xl/sharedStrings.xml');
  if (!text) return [];
  const items = byLocalName(parseXml(text), 'si');
  if (items.length > XLSX_MAX_SHARED_STRINGS) throw new XlsxError('too_large');
  return items.map(runText);
}

function cellValue(c: Element, shared: readonly string[]): string {
  const type = c.getAttribute('t');
  const v = childrenNamed(c, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's':
      return shared[Number(v)] ?? '';
    case 'inlineStr': {
      const is = childrenNamed(c, 'is')[0];
      return is ? runText(is) : '';
    }
    case 'b':
      return v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
    case 'e':
      return '';
    default:
      return v;
  }
}

/** The first sheet as rows of strings; gaps (sparse rows and cells) are filled with `''`. */
export async function readXlsx(
  bytes: Uint8Array,
  budget = XLSX_INFLATE_BUDGET,
): Promise<string[][]> {
  const zip = new ZipReader(bytes, budget);
  const path = await firstSheetPath(zip);
  const shared = await sharedStrings(zip);
  const sheetText = await zip.text(path);
  if (!sheetText) throw new XlsxError('format');
  const rows: string[][] = [];
  for (const rowEl of byLocalName(parseXml(sheetText), 'row')) {
    const r = Number(rowEl.getAttribute('r'));
    const index = Number.isInteger(r) && r > 0 ? r - 1 : rows.length;
    const cells: string[] = [];
    let next = 0;
    for (const c of childrenNamed(rowEl, 'c')) {
      const col = columnOf(c.getAttribute('r')) ?? next;
      next = col + 1;
      const value = cellValue(c, shared);
      // Formatted but empty cells (often far to the right) add nothing.
      if (value === '') continue;
      if (col > MAX_COLUMN_INDEX) throw new XlsxError('too_large');
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    if (cells.length === 0) continue;
    if (index > MAX_ROW_INDEX) throw new XlsxError('too_large');
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}
