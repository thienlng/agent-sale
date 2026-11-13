/**
 * LM3-2: the bot recorded requests nobody asked for (a parent who only introduced herself to
 * complain; "có học thử ko?" answered "yêu cầu học thử đã được ghi nhận"). record_request needs a
 * customer message that asks for something: to register, book, try, see a demo, be advised or be
 * called. A question about availability is not a request. Accent-insensitive (folded text).
 */
const INTENT = new RegExp(
  [
    'dang k[yi]',
    'dat[^.?!\\n]{0,20}(lich|hen|cho|giup|cho)',
    'dat lich',
    'giu (lich|cho)',
    'lay lich',
    'hen (lich|gio)',
    'muon[^.?!\\n]{0,40}(hoc|lam|dat|dang|thu|tu van|demo|kiem tra|goi|xem)',
    'cho[^.?!\\n]{0,25}hoc thu',
    '(xin|nho|can|muon) tu van',
    'tu van (cho|giup|gium)',
    'goi (lai|cho|dien|minh|toi|chi|anh|em)',
    'lien he (lai|voi|cho)',
    'xem demo',
    'dung thu',
    'kiem tra (trinh do|dau vao)',
    '\\bbook(ing|ed)?\\b',
    '\\bregister',
    'sign up',
    'call (me|back)',
    'appointment',
    '\\btrial\\b',
  ].join('|'),
  'i',
);

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** A customer message of the conversation asks to register, book, try, be advised or be called. */
export function asksForRequest(customerTexts: readonly string[]): boolean {
  return customerTexts.some((text) => INTENT.test(fold(text)));
}
