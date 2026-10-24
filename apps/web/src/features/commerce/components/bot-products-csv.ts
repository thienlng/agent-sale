import type { ProductDto } from '@agent-sales/contracts';

/** Byte-order mark: tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** Quotes every cell and defuses spreadsheet formulas (`=`, `+`, `-`, `@` prefixes). */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export type ProductCsvHeaders = {
  code: string;
  name: string;
  priceMin: string;
  priceMax: string;
  description: string;
  updatedAt: string;
};

/** CSV of the products shown in the bot's products table (prices in integer VND). */
export function formatProductsCsv(products: readonly ProductDto[], headers: ProductCsvHeaders) {
  const head = [
    headers.code,
    headers.name,
    headers.priceMin,
    headers.priceMax,
    headers.description,
    headers.updatedAt,
  ];
  const rows = products.map((p) => [
    p.code,
    p.name,
    p.priceMin,
    p.priceMax,
    p.description,
    p.updatedAt,
  ]);
  return BOM + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
