import { describe, expect, it } from 'vitest';
import { UpdateConversationRequest } from './conversation.schema.js';

describe('conversation follow-up control contract', () => {
  it('accepts UTC schedules, clearing and legacy controls', () => {
    expect(UpdateConversationRequest.safeParse({ mode: 'human' }).success).toBe(true);
    expect(
      UpdateConversationRequest.parse({
        followUpAt: '2026-10-25T08:00:00Z',
        followUpNote: ' Call back ',
        expectedRevision: 0,
      }),
    ).toMatchObject({ followUpNote: 'Call back' });
    expect(
      UpdateConversationRequest.safeParse({ followUpAt: null, followUpNote: '' }).success,
    ).toBe(true);
  });
  it('rejects ambiguous local timestamps, oversized notes and invalid revisions', () => {
    for (const input of [
      { followUpAt: '2026-10-25T08:00' },
      { followUpAt: 'tomorrow' },
      { followUpNote: 'x'.repeat(501) },
      { expectedRevision: -1 },
    ])
      expect(UpdateConversationRequest.safeParse(input).success).toBe(false);
  });
});
