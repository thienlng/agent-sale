import { describe, expect, it } from 'vitest';

import { profileProgress, setupSteps } from './setup-steps';

const botId = 'bot-1';
const empty = {
  botId,
  channels: [],
  productCount: 0,
  trainingKinds: [],
  faqCount: 0,
  profile: { complete: false, emptyCount: 8 },
};

describe('setupSteps', () => {
  it('lists the channel step first and nothing done for a new bot', () => {
    const steps = setupSteps(empty);
    expect(steps.map((s) => s.key)).toEqual([
      'channel',
      'profile',
      'products',
      'scenarios',
      'faqs',
    ]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[0]?.to).toBe('/app/bots/$botId/integrations');
  });

  it('counts only a connected channel assigned to this bot', () => {
    const other = setupSteps({
      ...empty,
      channels: [
        { botId: 'bot-2', status: 'connected' },
        { botId, status: 'reauth_required' },
        { botId: null, status: 'connected' },
      ],
    });
    expect(other[0]?.done).toBe(false);
    const mine = setupSteps({ ...empty, channels: [{ botId, status: 'connected' }] });
    expect(mine[0]?.done).toBe(true);
  });

  it('marks data steps done from products, scenarios and FAQs', () => {
    const steps = setupSteps({
      ...empty,
      productCount: 3,
      trainingKinds: ['quick_reply', 'scenario'],
      faqCount: 1,
    });
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual([
      'products',
      'scenarios',
      'faqs',
    ]);
  });

  it('ignores training items that are not scenarios', () => {
    const steps = setupSteps({ ...empty, trainingKinds: ['media', 'quick_reply'] });
    expect(steps.find((s) => s.key === 'scenarios')?.done).toBe(false);
  });

  it('marks the business information step done when the basic fields are filled', () => {
    const steps = setupSteps({ ...empty, profile: { complete: true, emptyCount: 2 } });
    const profile = steps.find((s) => s.key === 'profile');
    expect(profile?.done).toBe(true);
    expect(profile?.to).toBe('/app/bots/$botId/knowledge');
    expect(profile?.emptyCount).toBe(2);
  });

  it('keeps the step open while a basic field is empty and reports the empty count', () => {
    const profile = setupSteps(empty).find((s) => s.key === 'profile');
    expect(profile).toMatchObject({ done: false, emptyCount: 8 });
  });
});

describe('profileProgress', () => {
  it('is complete once the four basic fields are filled; mapsUrl is optional', () => {
    const fields = { displayName: 'A', address: 'B', hotline: ' 0900 ', hours: 'D' };
    expect(profileProgress('hotel', fields)).toEqual({ complete: true, emptyCount: 9 });
    expect(profileProgress('hotel', { ...fields, hours: ' ' }).complete).toBe(false);
  });

  it('counts the empty fields of the bot industry only', () => {
    // basic 5 + hotel-only 8 = 13 fields, nothing filled.
    expect(profileProgress('hotel', {})).toEqual({ complete: false, emptyCount: 13 });
  });
});
