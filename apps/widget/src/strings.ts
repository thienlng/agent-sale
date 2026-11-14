import type { WidgetLanguage } from './types.js';

export interface Strings {
  open: string;
  close: string;
  minimize: string;
  /** Next to the bubble on hover. */
  chatWith(name: string): string;
  /** Under the composer. */
  poweredBy: string;
  /** The device lost its network connection. */
  offline: string;
  send: string;
  /** Under the agent name in the header. */
  status: string;
  placeholder: string;
  attach: string;
  rateLimited: string;
  failed: string;
  retry: string;
  typing: string;
  phonePlaceholder: string;
  phoneSend: string;
  phoneCancel: string;
  invalidPhone: string;
  contactPlaceholder: string;
  namePlaceholder: string;
  invalidContact: string;
  uploadFailed: string;
  genericError: string;
  defaultGreeting: string;
  defaultAgent: string;
  defaultPhonePrompt: string;
  defaultPhoneChip: string;
  /** Product cards (ADR-029). */
  products: string;
  learnMore: string;
  previous: string;
  next: string;
  /** The question a card sends. */
  askAbout(title: string): string;
}

const vi: Strings = {
  open: 'Mở chat',
  close: 'Đóng',
  minimize: 'Thu nhỏ',
  chatWith: (name) => `Chat với ${name}`,
  poweredBy: 'Được hỗ trợ bởi Rapiz AI',
  offline: 'Mất kết nối mạng, vui lòng kiểm tra lại kết nối.',
  send: 'Gửi',
  status: 'Sẵn sàng hỗ trợ',
  placeholder: 'Nhập tin nhắn...',
  attach: 'Gửi ảnh',
  rateLimited: 'Bạn nhắn hơi nhanh, vui lòng thử lại sau ít giây.',
  failed: 'Chưa gửi được. Chạm để thử lại.',
  retry: 'Thử lại',
  typing: 'Đang trả lời',
  phonePlaceholder: 'Số điện thoại của bạn',
  phoneSend: 'Gửi số',
  phoneCancel: 'Quay lại',
  invalidPhone: 'Số điện thoại chưa đúng, vui lòng kiểm tra lại.',
  contactPlaceholder: 'Số điện thoại hoặc email',
  namePlaceholder: 'Tên của bạn (không bắt buộc)',
  invalidContact: 'Số điện thoại hoặc email chưa đúng, vui lòng kiểm tra lại.',
  uploadFailed: 'Không gửi được ảnh, vui lòng thử ảnh khác.',
  genericError: 'Có lỗi xảy ra, vui lòng thử lại sau.',
  defaultGreeting: 'Xin chào! Bạn cần hỗ trợ gì ạ?',
  defaultAgent: 'Hỗ trợ',
  defaultPhonePrompt: 'Để lại số điện thoại để chúng tôi liên hệ nhanh hơn nhé.',
  defaultPhoneChip: 'Để lại số điện thoại',
  products: 'Sản phẩm',
  learnMore: 'Tìm hiểu thêm',
  previous: 'Trước',
  next: 'Tiếp',
  askAbout: (title) => `Cho mình tìm hiểu thêm về ${title}`,
};

const en: Strings = {
  open: 'Open chat',
  close: 'Close',
  minimize: 'Minimize',
  chatWith: (name) => `Chat with ${name}`,
  poweredBy: 'Powered by Rapiz AI',
  offline: 'You are offline, please check your connection.',
  send: 'Send',
  status: 'Ready to help',
  placeholder: 'Type a message...',
  attach: 'Send an image',
  rateLimited: 'You are sending messages too fast, please try again in a few seconds.',
  failed: 'Not sent. Tap to retry.',
  retry: 'Retry',
  typing: 'Typing',
  phonePlaceholder: 'Your phone number',
  phoneSend: 'Send number',
  phoneCancel: 'Back',
  invalidPhone: 'That phone number looks wrong, please check it.',
  contactPlaceholder: 'Phone number or email',
  namePlaceholder: 'Your name (optional)',
  invalidContact: 'That phone number or email looks wrong, please check it.',
  uploadFailed: 'Could not send the image, please try another one.',
  genericError: 'Something went wrong, please try again later.',
  defaultGreeting: 'Hi! How can we help you?',
  defaultAgent: 'Support',
  defaultPhonePrompt: 'Leave your phone number so we can reach you faster.',
  defaultPhoneChip: 'Leave your phone number',
  products: 'Products',
  learnMore: 'Learn more',
  previous: 'Previous',
  next: 'Next',
  askAbout: (title) => `Tell me more about ${title}`,
};

export function getStrings(language: WidgetLanguage): Strings {
  return language === 'en' ? en : vi;
}
