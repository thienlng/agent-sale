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
}): string {
  return [
    LENGTH[bot.replyLength],
    TONE[bot.tone],
    bot.allowEmoji ? 'A few emoji are welcome.' : 'Do not use emoji.',
    CREATIVITY[bot.creativity],
  ].join(' ');
}
