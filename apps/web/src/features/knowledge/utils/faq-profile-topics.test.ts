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
    ['Có cho dùng thử không', 'saas', 'freeTrial'],
    ['Đặt lịch demo được không', 'saas', 'demo'],
    ['Bảng giá các gói thế nào', 'saas', 'plans'],
    ['Có tích hợp Zalo không', 'saas', 'integrations'],
    ['Huỷ gói có được hoàn tiền không', 'saas', 'refundPolicy'],
    ['Cho con học thử được không', 'education', 'courseTrial'],
    ['Có kiểm tra trình độ miễn phí không', 'education', 'courseTrial'],
    ['Học phí khoá IELTS bao nhiêu', 'education', 'courseFees'],
    ['Lịch khai giảng tháng này', 'education', 'courseSchedule'],
    ['Nghỉ giữa chừng có được bảo lưu không', 'education', 'refundPolicy'],
    ['Bên mình có chi nhánh ở Quận 7 không', 'education', 'branches'],
    ['Cơ sở gần nhất ở đâu', 'spa', 'branches'],
    ['Muốn đặt lịch gội đầu', 'spa', 'booking'],
    ['Em muốn dời lịch sang mai', 'spa', 'reschedule'],
    ['Đến trễ 15 phút có sao không', 'spa', 'reschedule'],
    ['Bảng giá dịch vụ chăm sóc da', 'spa', 'servicePrices'],
    ['Tháng này có ưu đãi gì không', 'spa', 'promotion'],
    ['Đang có khuyến mãi không shop', 'retail', 'promotion'],
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
