import { describe, expect, it } from 'vitest';

import { setupSteps } from './setup-steps';

const botId = 'bot-1';
const empty = { botId, channels: [], productCount: 0, trainingKinds: [], faqCount: 0 };

describe('setupSteps', () => {
  it('lists the channel step first and nothing done for a new bot', () => {
    const steps = setupSteps(empty);
    expect(steps.map((s) => s.key)).toEqual(['channel', 'products', 'scenarios', 'faqs']);
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
    expect(steps[2]?.done).toBe(false);
  });
});
