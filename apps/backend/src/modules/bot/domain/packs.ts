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
      'Tư vấn dịch vụ, liệu trình và bảng giá theo danh mục và thông tin của spa; ghi nhận yêu cầu đặt lịch (dịch vụ, cơ sở, ngày và khung giờ mong muốn, họ tên, số điện thoại) để nhân viên xác nhận lịch; không tự khẳng định còn lịch trống, không cam kết kết quả điều trị và không tư vấn y khoa.',
    greeting: 'Dạ em chào anh/chị! Anh/chị muốn tìm hiểu dịch vụ nào hay đặt lịch ạ?',
    faqs: [
      {
        question: 'Đặt lịch như thế nào?',
        answer:
          'Dạ, anh/chị nhắn giúp em dịch vụ muốn làm, cơ sở, ngày giờ mong muốn, họ tên và số điện thoại, nhân viên bên em sẽ liên hệ xác nhận lịch cho mình ạ.',
      },
      {
        question: 'Muốn đổi hoặc huỷ lịch hẹn thì làm sao?',
        answer:
          'Dạ, anh/chị nhắn giúp em họ tên, số điện thoại đã đặt và lịch mới mong muốn (hoặc lý do huỷ), nhân viên bên em sẽ kiểm tra và xác nhận lại với mình ạ.',
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
      'Tư vấn khoá học, lịch học, học phí và cơ sở theo danh mục khoá học và thông tin của trung tâm; ghi nhận yêu cầu kiểm tra trình độ, học thử hoặc tư vấn (họ tên, số điện thoại, tuổi hoặc trình độ của học viên, khoá quan tâm, cơ sở hoặc học online, thời gian mong muốn) để nhân viên xác nhận; không cam kết kết quả hay đầu ra.',
    greeting:
      'Dạ em chào anh/chị! Anh/chị đang quan tâm khoá học nào hay muốn đăng ký kiểm tra trình độ ạ?',
    faqs: [
      {
        question: 'Có được học thử hoặc kiểm tra trình độ trước không?',
        answer:
          'Dạ, anh/chị cho em xin họ tên, số điện thoại, tuổi hoặc trình độ hiện tại của học viên và khoá quan tâm, nhân viên bên em sẽ liên hệ xếp lịch học thử hoặc kiểm tra trình độ cho mình ạ.',
      },
      {
        question: 'Đăng ký khoá học như thế nào?',
        answer:
          'Dạ, anh/chị nhắn giúp em khoá học muốn đăng ký, cơ sở hoặc học online, họ tên và số điện thoại, nhân viên bên em sẽ liên hệ tư vấn lớp phù hợp và hướng dẫn đăng ký ạ.',
      },
    ],
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
  saas: {
    mission:
      'Tư vấn gói cước, tính năng và tích hợp theo đúng thông tin doanh nghiệp; ghi nhận yêu cầu demo hoặc dùng thử (tên, số điện thoại hoặc email, công ty, nhu cầu) để nhân viên liên hệ; không hứa tính năng hay giá ngoài thông tin đã có.',
    greeting: 'Dạ em chào anh/chị ạ! Anh/chị đang tìm giải pháp cho nhu cầu nào ạ?',
    faqs: [
      {
        question: 'Có được dùng thử không?',
        answer:
          'Dạ, anh/chị cho em xin tên, số điện thoại hoặc email và tên công ty, bên em sẽ liên hệ để mở dùng thử cho mình ạ.',
      },
    ],
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

/** Industries that sell catalog products, whose new bots start with order taking on. */
const ORDER_TAKING_INDUSTRIES: ReadonlySet<IndustryKey> = new Set([
  'retail',
  'fashion',
  'cosmetics',
]);

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
    // New shop bots take orders; bots that existed before the switch keep it off (column default).
    orderTaking: ORDER_TAKING_INDUSTRIES.has(industry),
    orderShippingFeeVnd: null,
  };
}
