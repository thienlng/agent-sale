import { describe, expect, it } from 'vitest';
import { BotSettings, UpdateBotRequest } from '../bot/bot.schema.js';
import { CreateTrainingItemRequest, UpdateTrainingItemRequest } from './knowledge.schema.js';

describe('Training boundary schemas', () => {
  it('validates material content and HTTPS-only media without accepting empty edits', () => {
    expect(
      CreateTrainingItemRequest.parse({
        kind: 'scenario',
        title: ' Returns ',
        content: ' Policy ',
      }),
    ).toMatchObject({ title: 'Returns', content: 'Policy', trigger: '', mediaUrl: null });
    expect(
      CreateTrainingItemRequest.safeParse({
        kind: 'media',
        title: 'Photo',
        content: 'Description',
        mediaUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(UpdateTrainingItemRequest.safeParse({}).success).toBe(false);
    expect(UpdateTrainingItemRequest.safeParse({ unknown: true }).success).toBe(false);
  });
  it('does not reset optional media, shortcuts or handover settings during unrelated updates', () => {
    expect(UpdateTrainingItemRequest.parse({ title: 'Edited title' })).toEqual({
      title: 'Edited title',
    });
    expect(UpdateTrainingItemRequest.parse({ mediaUrl: null })).toEqual({ mediaUrl: null });
    expect(UpdateBotRequest.parse({ settings: { mission: 'Updated mission' } })).toEqual({
      settings: { mission: 'Updated mission' },
    });
    expect(BotSettings.shape.humanTakeoverMinutes.safeParse(0).success).toBe(false);
    expect(BotSettings.shape.humanTakeoverMinutes.safeParse(1441).success).toBe(false);
    expect(BotSettings.shape.humanTakeoverMinutes.parse(undefined)).toBe(5);
  });
});
