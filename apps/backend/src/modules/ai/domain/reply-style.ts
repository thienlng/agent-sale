export type ReplyLength = 'veryShort' | 'short' | 'detailed';
export type ReplyTone = 'friendly' | 'formal';
export type Creativity = 'strict' | 'balanced' | 'creative';

const LENGTH: Record<ReplyLength, string> = {
  veryShort: 'Reply in one or two short lines.',
  short: 'Reply in two to three short lines.',
  detailed: 'Reply in full detail, still in separate short lines.',
};

const TONE: Record<ReplyTone, string> = {
  friendly: 'Use a warm, friendly tone.',
  formal: 'Use a polite, formal tone.',
};

/** Vietnamese register: the polite "dạ … ạ" frame lost when the style rules became settings. */
const VI_TONE: Record<ReplyTone, string> = {
  friendly:
    'Open or close politely with "dạ … ạ" in a warm, natural, friendly tone, never stiff or robotic.',
  formal: 'Open or close politely with "dạ … ạ" in a respectful, formal tone, with no slang.',
};

const NO_WAIT =
  'Never tell the customer to wait or that you will reply later unless the conversation is handed over to staff.';

const CREATIVITY: Record<Creativity, string> = {
  strict: 'Stay close to the wording of the knowledge entries.',
  balanced: 'Rephrase the knowledge naturally, keeping every fact exact.',
  creative: 'Be lively and persuasive, but every fact must still come from the knowledge.',
};

/** The `{{bot.style}}` line of prompt @9: length, tone, emoji and how freely to rephrase. */
export function replyStyle(bot: {
  replyLength: ReplyLength;
  tone: ReplyTone;
  allowEmoji: boolean;
  creativity: Creativity;
  language?: 'vi' | 'en';
}): string {
  return [
    LENGTH[bot.replyLength],
    bot.language === 'vi' ? VI_TONE[bot.tone] : TONE[bot.tone],
    bot.allowEmoji ? 'A few emoji are welcome.' : 'Do not use emoji.',
    CREATIVITY[bot.creativity],
    NO_WAIT,
  ].join(' ');
}
