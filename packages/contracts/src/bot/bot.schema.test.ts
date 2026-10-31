import { describe, expect, it } from 'vitest';

import { BotSettings, ReplySchedule, UpdateBotRequest } from './bot.schema.js';

describe('UpdateBotRequest', () => {
  it('does not inject defaults for settings the client did not send', () => {
    const parsed = UpdateBotRequest.parse({ settings: { mission: 'Bán giày' } });
    expect(parsed.settings).toEqual({ mission: 'Bán giày' });
  });

  it('accepts a theme colour and a custom reply window', () => {
    const parsed = UpdateBotRequest.parse({
      settings: {
        themeColor: '#112233',
        replySchedule: { mode: 'custom', start: '22:00', end: '06:00' },
      },
    });
    expect(parsed.settings?.replySchedule?.end).toBe('06:00');
  });
});

describe('ReplySchedule', () => {
  it('rejects an empty custom window and malformed times', () => {
    expect(ReplySchedule.safeParse({ mode: 'custom', start: '08:00', end: '08:00' }).success).toBe(
      false,
    );
    expect(ReplySchedule.safeParse({ mode: 'always', start: '24:00', end: '08:00' }).success).toBe(
      false,
    );
  });

  it('is filled in for settings stored before it existed', () => {
    const { replySchedule, themeColor, ...rest } = BotSettings.parse({
      mission: '',
      greeting: '',
      selfPronoun: 'em',
      customerPronoun: 'anh/chị',
      useCustomerName: true,
      fallbackMessage: '',
      handoffMessage: '',
      creativity: 'balanced',
      modelTier: 'smart',
      language: 'vi',
      placeholders: {},
    });
    expect(replySchedule.mode).toBe('always');
    expect(themeColor).toBe('#FF6600');
    expect(rest.autoResumeAfterManual).toBe(true);
  });
});

describe('order taking settings', () => {
  it('defaults to off with no shipping fee for stored settings that predate them', () => {
    const parsed = UpdateBotRequest.parse({ settings: { orderTaking: true } });
    expect(parsed.settings).toEqual({ orderTaking: true });
    const fee = UpdateBotRequest.parse({ settings: { orderShippingFeeVnd: null } });
    expect(fee.settings).toEqual({ orderShippingFeeVnd: null });
    expect(BotSettings.shape.orderTaking.parse(undefined)).toBe(false);
    expect(BotSettings.shape.orderShippingFeeVnd.parse(undefined)).toBeNull();
  });

  it('accepts a whole-VND shipping fee and rejects a negative or fractional one', () => {
    const ok = UpdateBotRequest.parse({ settings: { orderShippingFeeVnd: 30000 } });
    expect(ok.settings?.orderShippingFeeVnd).toBe(30000);
    for (const bad of [-1, 1.5])
      expect(UpdateBotRequest.safeParse({ settings: { orderShippingFeeVnd: bad } }).success).toBe(
        false,
      );
  });
});
