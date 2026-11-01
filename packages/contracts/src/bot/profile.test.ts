import { describe, expect, it } from 'vitest';

import { BotSettings, UpdateBotRequest } from './bot.schema.js';
import { BotProfile, PROFILE_FIELDS, PROFILE_NOTES_MAX, profileFieldsFor } from './profile.js';

const BASIC = ['displayName', 'address', 'mapsUrl', 'hotline', 'hours'];

describe('profileFieldsFor', () => {
  it('lists the five basic keys then the eight hotel keys', () => {
    expect(profileFieldsFor('hotel').map((f) => f.key)).toEqual([
      ...BASIC,
      'unitTypes',
      'rates',
      'checkInOut',
      'deposit',
      'cancellation',
      'amenities',
      'childrenPets',
      'directions',
    ]);
  });

  it('returns basic only for an unknown industry and for other', () => {
    expect(profileFieldsFor('nope').map((f) => f.key)).toEqual(BASIC);
    expect(profileFieldsFor('other').map((f) => f.key)).toEqual(BASIC);
  });

  it('pins the exact field set and order per industry', () => {
    const keys = (i: string) => profileFieldsFor(i).map((f) => f.key);
    const shop = [...BASIC, 'payment', 'shipping', 'returns', 'warranty', 'promotion'];
    expect(keys('retail')).toEqual(shop);
    expect(keys('fashion')).toEqual([...shop, 'sizeGuide']);
    expect(keys('cosmetics')).toEqual([...shop, 'authenticity']);
    expect(keys('spa')).toEqual([...BASIC, 'payment', 'servicePrices', 'booking']);
    expect(keys('dental')).toEqual([...BASIC, 'payment', 'servicePrices', 'booking']);
    expect(keys('education')).toEqual([...BASIC, 'courseFees', 'courseSchedule', 'courseTrial']);
    expect(keys('solar')).toEqual([...BASIC, 'warranty', 'priceRange', 'payback']);
    expect(keys('saas')).toEqual([
      ...BASIC,
      'payment',
      'plans',
      'freeTrial',
      'demo',
      'integrations',
      'onboarding',
      'support',
      'dataSecurity',
      'refundPolicy',
    ]);
  });

  it('has unique keys', () => {
    const keys = PROFILE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('BotProfile', () => {
  it('rejects an unknown key', () => {
    expect(BotProfile.safeParse({ fields: { nope: 'x' }, notes: '' }).success).toBe(false);
  });

  it('rejects a value over its max and notes over the limit', () => {
    expect(BotProfile.safeParse({ fields: { hotline: 'x'.repeat(61) }, notes: '' }).success).toBe(
      false,
    );
    expect(
      BotProfile.safeParse({ fields: {}, notes: 'x'.repeat(PROFILE_NOTES_MAX + 1) }).success,
    ).toBe(false);
    expect(BotProfile.safeParse({ fields: {}, notes: 'x'.repeat(PROFILE_NOTES_MAX) }).success).toBe(
      true,
    );
  });

  it('accepts only https maps URLs (or empty)', () => {
    const ok = (mapsUrl: string) =>
      BotProfile.safeParse({ fields: { mapsUrl }, notes: '' }).success;
    expect(ok('https://maps.google.com/?q=1')).toBe(true);
    expect(ok('')).toBe(true);
    expect(ok('http://maps.google.com')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('not a url')).toBe(false);
  });

  it('trims values', () => {
    expect(BotProfile.parse({ fields: { address: '  12 Le Loi  ' }, notes: ' hi ' })).toEqual({
      fields: { address: '12 Le Loi' },
      notes: 'hi',
    });
  });
});

describe('BotSettings profile and style', () => {
  const old = {
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
  };

  it('fills defaults for settings stored without the new keys', () => {
    const s = BotSettings.parse(old);
    expect(s.profile).toEqual({ fields: {}, notes: '' });
    expect(s.replyLength).toBe('short');
    expect(s.tone).toBe('friendly');
    expect(s.allowEmoji).toBe(false);
  });
});

describe('UpdateBotRequest profile and style', () => {
  it('accepts a partial profile (fields only, notes only) and rejects bad values', () => {
    const p = (profile: unknown) => UpdateBotRequest.safeParse({ settings: { profile } });
    expect(p({ fields: { address: 'x' } }).success).toBe(true);
    expect(p({ notes: 'n' }).success).toBe(true);
    expect(p({ fields: { address: '' } }).success).toBe(true);
    expect(p({ fields: { nope: 'x' } }).success).toBe(false);
    expect(p({ fields: { mapsUrl: 'http://x.com' } }).success).toBe(false);
    expect(p({ notes: 'x'.repeat(3001) }).success).toBe(false);
  });

  it('accepts a partial profile and the style keys without injecting defaults', () => {
    const parsed = UpdateBotRequest.parse({
      settings: {
        profile: { fields: { address: '12 Le Loi' }, notes: '' },
        replyLength: 'detailed',
        tone: 'formal',
        allowEmoji: true,
      },
    });
    expect(parsed.settings).toEqual({
      profile: { fields: { address: '12 Le Loi' }, notes: '' },
      replyLength: 'detailed',
      tone: 'formal',
      allowEmoji: true,
    });
  });

  it('does not add the new keys when they are not sent', () => {
    expect(UpdateBotRequest.parse({ settings: { mission: 'x' } }).settings).toEqual({
      mission: 'x',
    });
  });
});
