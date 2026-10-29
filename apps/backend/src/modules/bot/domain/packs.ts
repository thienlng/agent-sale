import type { BotSettingsData, IndustryKey } from './bot-settings.js';

/**
 * Industry seed packs (docs/17 §3). This is tenant seed DATA in the tenant's
 * language, not UI copy, so it lives here instead of packages/i18n. Business facts live in
 * the bot profile now, so a pack seeds only FAQs and greetings that need no `{{placeholder}}`
 * (nothing could fill it any more).
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

const GREETING = 'Dạ em chào anh/chị ạ! Em có thể giúp gì cho anh/chị ạ?';

const PACKS: Record<IndustryKey, IndustryPack> = {
  retail: {
    mission:
      'Tư vấn sản phẩm, báo giá đúng theo danh mục, xin số điện thoại và địa chỉ khi khách muốn mua, chuyển nhân viên khi khách khiếu nại hoặc hỏi ngoài phạm vi.',
    greeting: GREETING,
    faqs: [],
  },
  fashion: {
    mission:
      'Tư vấn mẫu, size, màu theo danh mục; hỏi chiều cao cân nặng để gợi ý size; xin thông tin giao hàng khi khách chốt đơn.',
    greeting: GREETING,
    faqs: [],
  },
  cosmetics: {
    mission:
      'Tư vấn sản phẩm theo loại da và nhu cầu, không chẩn đoán bệnh da liễu, chuyển nhân viên với các câu hỏi về dị ứng hoặc điều trị.',
    greeting: GREETING,
    faqs: [],
  },
  spa: {
    mission:
      'Tư vấn dịch vụ và bảng giá, ghi nhận yêu cầu đặt lịch (dịch vụ, ngày giờ mong muốn, số điện thoại), không cam kết kết quả điều trị.',
    greeting: 'Dạ em chào anh/chị ạ! Anh/chị muốn tìm hiểu dịch vụ nào ạ?',
    faqs: [
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
    greeting: GREETING,
    faqs: [],
  },
  education: {
    mission:
      'Tư vấn khoá học, lịch học, học phí; ghi nhận đăng ký học thử (họ tên, số điện thoại, khoá quan tâm).',
    greeting: GREETING,
    faqs: [],
  },
  hotel: {
    mission:
      'Giới thiệu hạng phòng, tiện ích, chính sách; ghi nhận yêu cầu đặt phòng (ngày nhận/trả, số khách, hạng phòng) để lễ tân xác nhận.',
    greeting: 'Dạ em chào anh/chị ạ! Anh/chị dự định lưu trú ngày nào ạ?',
    faqs: [],
  },
  solar: {
    mission:
      'Tư vấn hệ điện mặt trời; hỏi tiền điện hằng tháng, diện tích mái, loại mái, tỉnh/thành để kỹ sư báo giá; không tự đưa giá cuối cùng.',
    greeting: GREETING,
    faqs: [],
  },
  other: {
    mission:
      'Trả lời câu hỏi của khách dựa trên thông tin doanh nghiệp, xin số điện thoại khi khách có nhu cầu.',
    greeting: GREETING,
    faqs: [],
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
    fallbackMessage:
      'Dạ, em chưa có thông tin này ạ. Anh/chị nhắn rõ hơn hoặc để lại số điện thoại để nhân viên hỗ trợ giúp mình nhé.',
    handoffMessage: 'Dạ, em đã chuyển cho nhân viên, anh/chị đợi một chút ạ.',
    creativity: 'balanced',
    modelTier: 'smart',
    language: 'vi',
    themeColor: '#FF6600',
    replySchedule: { mode: 'always', start: '08:00', end: '22:00' },
    profile: { fields: {}, notes: '' },
    replyLength: 'short',
    tone: 'friendly',
    allowEmoji: false,
    placeholders: {},
  };
}
