import { newId } from '@agent-sales/shared';

let last = '';

/**
 * A message id that sorts after every id this process handed out before. UUIDv7 only orders by
 * millisecond, so two receipts stored in the same millisecond would otherwise sort randomly,
 * and message ids are what decides arrival order ("which customer message is the newest").
 */
export function nextMessageId(): string {
  let id = newId();
  if (id <= last) {
    const hex = (BigInt(`0x${last.replaceAll('-', '')}`) + 1n).toString(16).padStart(32, '0');
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  last = id;
  return id;
}
