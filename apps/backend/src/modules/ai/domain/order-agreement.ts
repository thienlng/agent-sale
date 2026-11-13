import { isPlainAgreement } from './handoff-guard.js';

// Words that agree to an order summary, with and without accents. "dung" is left out on purpose:
// unaccented it is also "dừng" (stop) and "dùng" (use).
const AGREE = new Set(
  [
    'ok oke okay okie okela yes yep yeah sure confirm',
    'đúng chuẩn chính xác nhận đặt chốt đồng ý lấy tạo lên vâng dạ được',
    'chinh xac nhan dat chot dong y lay tao len vang da duoc dc',
  ]
    .join(' ')
    .split(' '),
);
const FILLER = new Set(
  [
    'rồi đơn hàng này đó vậy thế luôn nhé nha nhá nhen đi ạ với giúp giùm cho em chị anh mình tôi tui bạn shop ơi thì là như trên thông tin hết cả nhanh cảm ơn',
    'roi don hang nay do vay the luon nhe nha nhen di a voi giup gium cho em chi anh minh toi tui ban oi thi la nhu tren thong tin het ca nhanh cam on e c mk',
    'the order please thanks thank you it go ahead',
  ]
    .join(' ')
    .split(' '),
);

/** One message only agrees to the order summary ("Ok đúng rồi, chị xác nhận đặt đơn"). */
function agreesToOrder(text: string): boolean {
  if (isPlainAgreement(text)) return true;
  const words = text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length || words.length > 12 || words.some((w) => /\d/.test(w))) return false;
  return words.some((w) => AGREE.has(w)) && words.every((w) => AGREE.has(w) || FILLER.has(w));
}

/**
 * R5-1: the customer's newest messages (every message after the shop's last one) only agree to the
 * order summary that waits: a clear yes ("✅ Đặt hàng", "Ok đúng rồi, chị xác nhận đặt đơn", "tạo
 * đơn luôn giúp chị"), no change, number or question. "ok đổi sang 2 cái" is a change.
 */
export function isOrderAgreement(latestCustomerBlock: string): boolean {
  const lines = latestCustomerBlock
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every(agreesToOrder);
}
