import type { BotSettingsData, IndustryKey } from './bot-settings.js';

/**
 * Industry seed packs (docs/17 §3). This is tenant seed DATA in the tenant's
 * language, not UI copy, so it lives here instead of packages/i18n. Answers use
 * `{{placeholders}}` the owner must fill before the bot is ready — never vague
 * non-answers (the weakness observed in the reference product).
 */
export interface SeedFaq {
  question: string;
  answer: string;
}

export interface IndustryPack {
  mission: string;
  greeting: string;
  faqs: SeedFaq[];
}

const COMMON_FAQS: SeedFaq[] = [
  { question: 'Cửa hàng ở đâu?', answer: 'Dạ, địa chỉ của {{store.name}} là {{store.address}} ạ.' },
  { question: 'Giờ mở cửa thế nào?', answer: 'Dạ, bên em mở cửa {{store.hours}} ạ.' },
  {
    question: 'Thanh toán bằng những hình thức nào?',
    answer: 'Dạ, bên em nhận thanh toán: {{payment.methods}} ạ.',
  },
  {
    question: 'Số điện thoại / hotline là gì?',
    answer: 'Dạ, hotline của bên em là {{store.hotline}} ạ.',
  },
];

const RETAIL_FAQS: SeedFaq[] = [
  ...COMMON_FAQS,
  { question: 'Phí ship bao nhiêu, giao mất mấy ngày?', answer: 'Dạ, {{shipping.policy}} ạ.' },
  { question: 'Có được đổi trả không?', answer: 'Dạ, chính sách đổi trả: {{return.policy}} ạ.' },
];

const PACKS: Record<IndustryKey, IndustryPack> = {
  retail: {
    mission:
      'Tư vấn sản phẩm, báo giá đúng theo danh mục, xin số điện thoại và địa chỉ khi khách muốn mua, chuyển nhân viên khi khách khiếu nại hoặc hỏi ngoài phạm vi.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Anh/chị cần em tư vấn sản phẩm nào ạ?',
    faqs: RETAIL_FAQS,
  },
  fashion: {
    mission:
      'Tư vấn mẫu, size, màu theo danh mục; hỏi chiều cao cân nặng để gợi ý size; xin thông tin giao hàng khi khách chốt đơn.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Anh/chị đang tìm mẫu nào ạ?',
    faqs: [
      ...RETAIL_FAQS,
      { question: 'Chọn size thế nào?', answer: 'Dạ, bảng size của bên em: {{size.guide}} ạ.' },
    ],
  },
  cosmetics: {
    mission:
      'Tư vấn sản phẩm theo loại da và nhu cầu, không chẩn đoán bệnh da liễu, chuyển nhân viên với các câu hỏi về dị ứng hoặc điều trị.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Da của anh/chị thuộc loại nào để em tư vấn ạ?',
    faqs: [
      ...RETAIL_FAQS,
      { question: 'Sản phẩm có chính hãng không?', answer: 'Dạ, {{product.authenticity}} ạ.' },
    ],
  },
  spa: {
    mission:
      'Tư vấn dịch vụ và bảng giá, ghi nhận yêu cầu đặt lịch (dịch vụ, ngày giờ mong muốn, số điện thoại), không cam kết kết quả điều trị.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Anh/chị muốn tìm hiểu dịch vụ nào ạ?',
    faqs: [
      ...COMMON_FAQS,
      {
        question: 'Bảng giá dịch vụ thế nào?',
        answer: 'Dạ, bảng giá dịch vụ: {{service.prices}} ạ.',
      },
      {
        question: 'Đặt lịch như thế nào?',
        answer:
          'Dạ, anh/chị cho em xin dịch vụ, ngày giờ mong muốn và số điện thoại, bên em sẽ xác nhận lịch ạ.',
      },
    ],
  },
  dental: {
    mission:
      'Giới thiệu dịch vụ, ghi nhận lịch khám mong muốn; tuyệt đối không chẩn đoán hay chỉ định điều trị, mọi câu hỏi chuyên môn chuyển bác sĩ.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Anh/chị cần đặt lịch khám hay tư vấn dịch vụ nào ạ?',
    faqs: [
      ...COMMON_FAQS,
      { question: 'Chi phí khám bao nhiêu?', answer: 'Dạ, chi phí khám: {{service.prices}} ạ.' },
    ],
  },
  education: {
    mission:
      'Tư vấn khoá học, lịch học, học phí; ghi nhận đăng ký học thử (họ tên, số điện thoại, khoá quan tâm).',
    greeting: 'Dạ {{store.name}} xin chào ạ! Anh/chị quan tâm khoá học nào ạ?',
    faqs: [
      ...COMMON_FAQS,
      { question: 'Học phí bao nhiêu?', answer: 'Dạ, học phí: {{course.fees}} ạ.' },
      { question: 'Lịch học thế nào?', answer: 'Dạ, lịch học: {{course.schedule}} ạ.' },
      { question: 'Có học thử không?', answer: 'Dạ, {{course.trial}} ạ.' },
    ],
  },
  hotel: {
    mission:
      'Giới thiệu hạng phòng, tiện ích, chính sách; ghi nhận yêu cầu đặt phòng (ngày nhận/trả, số khách, hạng phòng) để lễ tân xác nhận.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Anh/chị dự định lưu trú ngày nào ạ?',
    faqs: [
      ...COMMON_FAQS,
      { question: 'Giờ nhận phòng và trả phòng?', answer: 'Dạ, {{hotel.checkin_checkout}} ạ.' },
      { question: 'Giá phòng bao nhiêu?', answer: 'Dạ, giá phòng tham khảo: {{hotel.rates}} ạ.' },
      { question: 'Chính sách huỷ phòng thế nào?', answer: 'Dạ, {{hotel.cancellation}} ạ.' },
    ],
  },
  solar: {
    mission:
      'Tư vấn hệ điện mặt trời; hỏi tiền điện hằng tháng, diện tích mái, loại mái, tỉnh/thành để kỹ sư báo giá; không tự đưa giá cuối cùng.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Tiền điện hằng tháng nhà mình khoảng bao nhiêu ạ?',
    faqs: [
      ...COMMON_FAQS,
      { question: 'Lắp điện mặt trời giá bao nhiêu?', answer: 'Dạ, {{solar.price_range}} ạ.' },
      { question: 'Bao lâu thì hoàn vốn?', answer: 'Dạ, {{solar.payback}} ạ.' },
      { question: 'Bảo hành thế nào?', answer: 'Dạ, {{solar.warranty}} ạ.' },
    ],
  },
  other: {
    mission:
      'Trả lời câu hỏi của khách dựa trên thông tin doanh nghiệp, xin số điện thoại khi khách có nhu cầu.',
    greeting: 'Dạ {{store.name}} xin chào ạ! Em có thể giúp gì cho anh/chị ạ?',
    faqs: COMMON_FAQS,
  },
};

export function packFor(industry: IndustryKey): IndustryPack {
  return PACKS[industry];
}

export function defaultSettings(industry: IndustryKey): BotSettingsData {
  const pack = packFor(industry);
  return {
    mission: pack.mission,
    greeting: pack.greeting,
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
    useCustomerName: true,
    autoResumeAfterManual: true,
    humanTakeoverMinutes: 5,
    silenceOnExternalReply: true,
    fallbackMessage: 'Dạ, em chưa có thông tin này, em sẽ chuyển nhân viên hỗ trợ anh/chị ngay ạ.',
    handoffMessage: 'Dạ, em đã chuyển cho nhân viên, anh/chị đợi một chút ạ.',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    themeColor: '#FF6600',
    replySchedule: { mode: 'always', start: '08:00', end: '22:00' },
    placeholders: {},
  };
}
