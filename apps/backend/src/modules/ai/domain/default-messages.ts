/**
 * What the bot says when the owner left the fallback or handoff message empty.
 * Never the model's own text: those paths exist because the model's answer
 * cannot be trusted. Tenant-facing content in the bot's language, so it lives
 * here rather than in the UI i18n files.
 */
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export function defaultFallbackMessage(bot: {
  language: 'vi' | 'en';
  selfPronoun: string;
  customerPronoun: string;
}): string {
  return bot.language === 'en'
    ? "I don't have that information yet. Please tell us more or leave a phone number so our staff can help."
    : `Dạ, ${bot.selfPronoun} chưa có thông tin này ạ. ${cap(bot.customerPronoun)} nhắn rõ hơn hoặc để lại số điện thoại để nhân viên hỗ trợ giúp mình nhé.`;
}

export function defaultHandoffMessage(bot: {
  language: 'vi' | 'en';
  selfPronoun: string;
  customerPronoun: string;
}): string {
  return bot.language === 'en'
    ? "I've passed your conversation to our staff. They'll reply shortly."
    : `Dạ, ${bot.selfPronoun} đã chuyển cho nhân viên hỗ trợ, ${bot.customerPronoun} đợi một chút ạ.`;
}
