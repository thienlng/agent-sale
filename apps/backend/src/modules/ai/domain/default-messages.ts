/**
 * What the bot says when the owner left the fallback or handoff message empty.
 * Never the model's own text: those paths exist because the model's answer
 * cannot be trusted. Tenant-facing content in the bot's language, so it lives
 * here rather than in the UI i18n files.
 */
export function defaultFallbackMessage(bot: {
  language: 'vi' | 'en';
  selfPronoun: string;
  customerPronoun: string;
}): string {
  return bot.language === 'en'
    ? "I don't have that information yet. Let me check and get back to you."
    : `Dạ, ${bot.selfPronoun} chưa có thông tin này, ${bot.selfPronoun} sẽ kiểm tra lại và báo ${bot.customerPronoun} ngay ạ.`;
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
