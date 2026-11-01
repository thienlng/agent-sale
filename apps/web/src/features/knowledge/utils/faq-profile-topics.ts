import { type ProfileFieldKey, profileFieldsFor } from '@agent-sales/contracts';
import { foldVietnamese } from '@agent-sales/shared';

/**
 * Profile topics an FAQ question can repeat, with the phrases that reveal them. Phrases are
 * written with diacritics for readability and folded before matching. Order = priority: industry-specific topics first, so "nhận phòng lúc mấy giờ" is check-in, not hours.
 */
const TOPICS: ReadonlyArray<readonly [ProfileFieldKey, readonly string[]]> = [
  ['checkInOut', ['nhận phòng', 'trả phòng', 'check in', 'check out']],
  ['deposit', ['đặt cọc', 'cọc']],
  ['cancellation', ['hủy', 'huỷ', 'đổi lịch']],
  ['rates', ['giá phòng']],
  ['directions', ['đường đi', 'đưa đón']],
  ['freeTrial', ['dùng thử', 'trial']],
  ['demo', ['demo']],
  ['plans', ['gói cước', 'bảng giá', 'báo giá', 'bao nhiêu tiền một tháng']],
  ['integrations', ['tích hợp', 'kết nối']],
  ['refundPolicy', ['hoàn tiền', 'hủy gói', 'huỷ gói']],
  ['shipping', ['ship', 'giao hàng', 'phí vận chuyển']],
  ['returns', ['đổi trả', 'đổi size', 'hoàn tiền']],
  ['warranty', ['bảo hành']],
  ['address', ['địa chỉ', 'ở đâu']],
  ['hours', ['giờ mở cửa', 'mấy giờ', 'giờ làm việc']],
  ['payment', ['thanh toán', 'cod', 'chuyển khoản']],
  ['hotline', ['hotline', 'số điện thoại', 'sđt', 'zalo']],
];

const FOLDED = TOPICS.map(
  ([key, phrases]) => [key, phrases.map((p) => foldVietnamese(p))] as const,
);

/** True when `phrase` appears in `text` as whole words ("ship" matches "phí ship", not "relationship"). */
function hasPhrase(text: string, phrase: string): boolean {
  let from = text.indexOf(phrase);
  while (from !== -1) {
    const before = text[from - 1];
    const after = text[from + phrase.length];
    if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) return true;
    from = text.indexOf(phrase, from + 1);
  }
  return false;
}

/**
 * The profile field of the bot's industry that the question seems to repeat, or null.
 * Topics whose field the industry does not have are skipped.
 */
export function profileFieldForQuestion(
  question: string,
  industry: string,
): ProfileFieldKey | null {
  const text = foldVietnamese(question);
  if (!text) return null;
  const available = new Set<ProfileFieldKey>(profileFieldsFor(industry).map((d) => d.key));
  for (const [key, phrases] of FOLDED)
    if (available.has(key) && phrases.some((p) => hasPhrase(text, p))) return key;
  return null;
}

/** DOM id of a profile field's input in the business information form. */
export const profileFieldInputId = (key: ProfileFieldKey) => `bp-${key}`;
