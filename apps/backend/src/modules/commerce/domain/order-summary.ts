import { formatVnd } from '@agent-sales/shared';

/** One line of a bot order summary: catalog names and the line total in integer VND. */
export interface SummaryLine {
  productName: string;
  variantName: string;
  qty: number;
  lineTotal: number;
}

export interface OrderSummaryInput {
  lines: readonly SummaryLine[];
  /** Null: the shop has no default fee and tells the customer later. */
  shippingFee: number | null;
  total: number;
  recipient: { name: string; phone: string; address: string };
  note: string | null;
}

/** The summary is one chat message; Messenger allows 2 000 characters. */
export const SUMMARY_MAX_CHARS = 2000;
/** Product lines listed before the rest are folded into "… và N sản phẩm khác". */
const MAX_LISTED_LINES = 8;
const MAX_NAME_CHARS = 120;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** `0912345678` → `0912 345 678`; anything else is shown as given. */
export function formatSummaryPhone(phone: string): string {
  return /^0\d{9}$/.test(phone)
    ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`
    : phone;
}

function lineText(l: SummaryLine): string {
  const variant = l.variantName.trim();
  const name = variant ? `${l.productName.trim()} (${variant})` : l.productName.trim();
  return `• ${clip(name, MAX_NAME_CHARS)} ×${l.qty} — ${formatVnd(l.lineTotal)}`;
}

function render(input: OrderSummaryInput, listed: number): string {
  const shown = input.lines.slice(0, listed).map(lineText);
  const hidden = input.lines.length - shown.length;
  const note = input.note?.trim();
  return [
    'Dạ em tóm tắt đơn của mình ạ:',
    ...shown,
    ...(hidden > 0 ? [`… và ${hidden} sản phẩm khác`] : []),
    input.shippingFee === null
      ? 'Phí ship: shop báo sau'
      : `Phí ship: ${formatVnd(input.shippingFee)}`,
    `Tổng: ${formatVnd(input.total)}`,
    `Người nhận: ${clip(input.recipient.name, MAX_NAME_CHARS)} · ${formatSummaryPhone(input.recipient.phone)}`,
    `Địa chỉ: ${clip(input.recipient.address, 300)}`,
    ...(note ? [`Ghi chú: ${clip(note, 300)}`] : []),
  ].join('\n');
}

/**
 * The fixed Vietnamese order summary the server sends before the customer confirms (spec §4.4).
 * Never guesses how to address the customer. At most SUMMARY_MAX_CHARS characters: long product
 * lists end with "… và N sản phẩm khác".
 */
export function buildOrderSummary(input: OrderSummaryInput): string {
  const fits = input.lines.length <= MAX_LISTED_LINES;
  let listed = fits ? input.lines.length : MAX_LISTED_LINES - 1;
  let text = render(input, listed);
  while (text.length > SUMMARY_MAX_CHARS && listed > 1) {
    listed -= 1;
    text = render(input, listed);
  }
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…` : text;
}
