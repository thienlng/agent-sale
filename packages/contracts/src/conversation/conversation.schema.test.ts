import { describe, expect, it } from 'vitest';
import { ConversationListQuery, UpdateConversationRequest } from './conversation.schema.js';

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

describe('conversation list bot and activity-time filters', () => {
  const bot = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  it('accepts a bot id, "none" and an ordered activity window with offsets', () => {
    expect(ConversationListQuery.parse({ botId: bot }).botId).toBe(bot);
    expect(ConversationListQuery.parse({ botId: 'none' }).botId).toBe('none');
    expect(
      ConversationListQuery.parse({
        updatedFrom: '2026-10-28T17:00:00.000Z',
        updatedTo: '2026-10-30T00:00:00+07:00',
      }),
    ).toMatchObject({ updatedFrom: '2026-10-28T17:00:00.000Z' });
    expect(ConversationListQuery.safeParse({ updatedFrom: '2026-10-28T17:00:00Z' }).success).toBe(
      true,
    );
  });
  it('rejects unknown bot values, local timestamps and an empty or inverted window', () => {
    for (const input of [
      { botId: 'all' },
      { botId: 'bot-1' },
      { updatedFrom: '2026-10-28' },
      { updatedTo: '2026-10-28T08:00' },
      { updatedFrom: '2026-10-29T00:00:00Z', updatedTo: '2026-10-29T00:00:00Z' },
      { updatedFrom: '2026-10-29T00:00:00Z', updatedTo: '2026-10-28T00:00:00Z' },
    ])
      expect(ConversationListQuery.safeParse(input).success).toBe(false);
  });
});
