// Words that agree to an order summary, with and without accents: a message needs one of these.
// "dung" is left out on purpose: unaccented it is also "dừng" (stop) and "dùng" (use).
const AGREE = new Set(
  ['đúng chuẩn xác đặt chốt đồng lấy tạo lên confirm confirmed', 'xac dat chot dong lay tao len']
    .join(' ')
    .split(' '),
);
// A bare "dạ", "vâng" or "ok shop" only acknowledges (review 2026-11-13): these words go with an
// agreement word, never alone.
const FILLER = new Set(
  [
    'ok oke okay okie okela yes yep yeah sure dạ vâng được da vang duoc dc',
    'nhận chính ý nhan chinh y',
    'rồi đơn hàng này đó vậy thế luôn nhé nha nhá nhen đi ạ với giúp giùm cho em chị anh mình tôi tui bạn shop ơi thì là như trên thông tin hết cả nhanh cảm ơn',
    'roi don hang nay do vay the luon nhe nha nhen di a voi giup gium cho em chi anh minh toi tui ban oi thi la nhu tren thong tin het ca nhanh cam on e c mk',
    'the order please thanks thank you it go ahead',
  ]
    .join(' ')
    .split(' '),
);

/**
 * R5-1: the customer's newest messages (every message after the shop's last one) only agree to the
 * order summary that waits: a clear yes ("✅ Đặt hàng", "Ok đúng rồi, chị xác nhận đặt đơn", "tạo
 * đơn luôn giúp chị"), no change, number or question. "ok đổi sang 2 cái" is a change; a bare
 * "dạ", "vâng" or "ok shop" is no agreement.
 */
export function isOrderAgreement(latestCustomerBlock: string): boolean {
  const words = latestCustomerBlock
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length || words.length > 16 || words.some((w) => /\d/.test(w))) return false;
  return words.some((w) => AGREE.has(w)) && words.every((w) => AGREE.has(w) || FILLER.has(w));
}
