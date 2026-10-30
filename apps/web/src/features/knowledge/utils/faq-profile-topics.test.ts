import { describe, expect, it } from 'vitest';

import { profileFieldForQuestion } from './faq-profile-topics';

describe('profileFieldForQuestion', () => {
  it.each([
    ['phí ship ra Hà Nội', 'retail', 'shipping'],
    ['PHI VAN CHUYEN la bao nhieu', 'fashion', 'shipping'],
    ['Có đổi size được không', 'fashion', 'returns'],
    ['Bảo hành mấy tháng', 'cosmetics', 'warranty'],
    ['Cửa hàng ở đâu', 'other', 'address'],
    ['Mấy giờ đóng cửa', 'other', 'hours'],
    ['Thanh toán COD được không', 'retail', 'payment'],
    ['Cho em xin sđt', 'other', 'hotline'],
    ['Nhận phòng lúc mấy giờ', 'hotel', 'checkInOut'],
    ['Có cần đặt cọc không', 'hotel', 'deposit'],
    ['Huỷ phòng có mất phí không', 'hotel', 'cancellation'],
    ['Giá phòng cuối tuần', 'hotel', 'rates'],
    ['Có đưa đón sân bay không', 'hotel', 'directions'],
  ])('maps "%s" (%s) to %s', (question, industry, field) => {
    expect(profileFieldForQuestion(question, industry)).toBe(field);
  });

  it('suggests nothing when the industry has no such field', () => {
    expect(profileFieldForQuestion('phí ship ra Hà Nội', 'hotel')).toBeNull();
    expect(profileFieldForQuestion('Có đưa đón sân bay không', 'retail')).toBeNull();
  });

  it('suggests nothing for a question without a known topic or with partial words', () => {
    expect(profileFieldForQuestion('Sản phẩm này có màu gì', 'retail')).toBeNull();
    expect(profileFieldForQuestion('relationship advice', 'retail')).toBeNull();
    expect(profileFieldForQuestion('', 'retail')).toBeNull();
  });
});
