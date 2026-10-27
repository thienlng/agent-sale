import type { WidgetLanguage } from './types.js';

export interface Strings {
  open: string;
  close: string;
  send: string;
  placeholder: string;
  attach: string;
  mute: string;
  unmute: string;
  rateLimited: string;
  failed: string;
  retry: string;
  typing: string;
  phonePlaceholder: string;
  phoneSend: string;
  phoneCancel: string;
  invalidPhone: string;
  uploadFailed: string;
  genericError: string;
  defaultGreeting: string;
  defaultAgent: string;
  defaultPhonePrompt: string;
  defaultPhoneChip: string;
}

const vi: Strings = {
  open: 'Mở chat',
  close: 'Đóng',
  send: 'Gửi',
  placeholder: 'Nhập tin nhắn...',
  attach: 'Gửi ảnh',
  mute: 'Tắt âm thanh',
  unmute: 'Bật âm thanh',
  rateLimited: 'Bạn nhắn hơi nhanh, vui lòng thử lại sau ít giây.',
  failed: 'Chưa gửi được. Chạm để thử lại.',
  retry: 'Thử lại',
  typing: 'Đang trả lời',
  phonePlaceholder: 'Số điện thoại của bạn',
  phoneSend: 'Gửi số',
  phoneCancel: 'Quay lại',
  invalidPhone: 'Số điện thoại chưa đúng, vui lòng kiểm tra lại.',
  uploadFailed: 'Không gửi được ảnh, vui lòng thử ảnh khác.',
  genericError: 'Có lỗi xảy ra, vui lòng thử lại sau.',
  defaultGreeting: 'Xin chào! Bạn cần hỗ trợ gì ạ?',
  defaultAgent: 'Hỗ trợ',
  defaultPhonePrompt: 'Để lại số điện thoại để chúng tôi liên hệ nhanh hơn nhé.',
  defaultPhoneChip: 'Để lại số điện thoại',
};

const en: Strings = {
  open: 'Open chat',
  close: 'Close',
  send: 'Send',
  placeholder: 'Type a message...',
  attach: 'Send an image',
  mute: 'Mute sound',
  unmute: 'Unmute sound',
  rateLimited: 'You are sending messages too fast, please try again in a few seconds.',
  failed: 'Not sent. Tap to retry.',
  retry: 'Retry',
  typing: 'Typing',
  phonePlaceholder: 'Your phone number',
  phoneSend: 'Send number',
  phoneCancel: 'Back',
  invalidPhone: 'That phone number looks wrong, please check it.',
  uploadFailed: 'Could not send the image, please try another one.',
  genericError: 'Something went wrong, please try again later.',
  defaultGreeting: 'Hi! How can we help you?',
  defaultAgent: 'Support',
  defaultPhonePrompt: 'Leave your phone number so we can reach you faster.',
  defaultPhoneChip: 'Leave your phone number',
};

export function getStrings(language: WidgetLanguage): Strings {
  return language === 'en' ? en : vi;
}
