import type { OrderSummaryDto } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

import type { OrderColumn } from '../components/order-columns';

/** Byte-order mark: tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Downloads the orders as CSV (UTF-8 with BOM so Excel shows Vietnamese correctly). */
export function downloadOrdersCsv(
  orders: OrderSummaryDto[],
  columns: readonly OrderColumn[],
  t: TFunction,
): void {
  const lines = [
    columns.map((c) => cell(t(c.header))).join(','),
    ...orders.map((o) => columns.map((c) => cell(c.csv(o, t))).join(',')),
  ];
  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `don-hang-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
