import { describe, expect, it } from 'vitest';

import { replyStyle } from '../domain/reply-style.js';

const base = {
  replyLength: 'short',
  tone: 'friendly',
  allowEmoji: false,
  creativity: 'balanced',
} as const;

describe('replyStyle', () => {
  it('maps each reply length to a fixed sentence', () => {
    expect(replyStyle({ ...base, replyLength: 'veryShort' })).toContain(
      'Reply in one or two short lines.',
    );
    expect(replyStyle({ ...base, replyLength: 'short' })).toContain(
      'Reply in two to three short lines.',
    );
    expect(replyStyle({ ...base, replyLength: 'detailed' })).toContain(
      'Reply in full detail, still in separate short lines.',
    );
  });

  it('maps tone and emoji', () => {
    expect(replyStyle({ ...base, tone: 'friendly' })).toContain('Use a warm, friendly tone.');
    expect(replyStyle({ ...base, tone: 'formal' })).toContain('Use a polite, formal tone.');
    expect(replyStyle({ ...base, allowEmoji: true })).toContain('A few emoji are welcome.');
    expect(replyStyle({ ...base, allowEmoji: false })).toContain('Do not use emoji.');
  });

  it('keeps the creativity sentence', () => {
    expect(replyStyle({ ...base, creativity: 'strict' })).toContain(
      'Stay close to the wording of the knowledge entries.',
    );
    expect(replyStyle({ ...base, creativity: 'creative' })).toContain(
      'Be lively and persuasive, but every fact must still come from the knowledge.',
    );
  });

  it('asks Vietnamese bots for the polite dạ … ạ register in both tones', () => {
    const friendly = replyStyle({ ...base, tone: 'friendly', language: 'vi' });
    expect(friendly).toContain('"dạ … ạ"');
    expect(friendly).toContain('warm');
    const formal = replyStyle({ ...base, tone: 'formal', language: 'vi' });
    expect(formal).toContain('"dạ … ạ"');
    expect(formal).toContain('no slang');
    expect(replyStyle({ ...base, tone: 'formal', language: 'en' })).not.toContain('dạ');
  });

  it('never lets the bot tell the customer to wait', () => {
    for (const language of ['vi', 'en'] as const)
      expect(replyStyle({ ...base, language })).toContain(
        'Never tell the customer to wait or that you will reply later unless the conversation is handed over to staff.',
      );
  });
});
