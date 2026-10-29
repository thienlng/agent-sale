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
});
