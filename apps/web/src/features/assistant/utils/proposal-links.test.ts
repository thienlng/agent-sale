import { describe, expect, it } from 'vitest';

import { openLinkFor } from './proposal-links';

const BOT = '0193b000-0000-7000-8000-000000000501';
const ACTION = '0193b000-0000-7000-8000-000000000601';
const done = {
  routeKey: 'POST /bots/{botId}/actions',
  path: `/bots/${BOT}/actions`,
  status: 'done' as const,
  resultId: ACTION,
};

describe('openLinkFor', () => {
  it('opens the created action of a done action draft', () => {
    expect(openLinkFor(done)).toEqual({ botId: BOT, actionId: ACTION });
  });

  it('is null until the draft is done with a result id', () => {
    expect(openLinkFor({ ...done, status: 'pending' })).toBeNull();
    expect(openLinkFor({ ...done, status: 'failed' })).toBeNull();
    expect(openLinkFor({ ...done, resultId: null })).toBeNull();
  });

  it('is null for every other route and for a path that is not a bot id', () => {
    expect(openLinkFor({ ...done, routeKey: 'POST /products', path: '/products' })).toBeNull();
    expect(openLinkFor({ ...done, routeKey: 'POST /bots/{botId}/faqs' })).toBeNull();
    expect(openLinkFor({ ...done, path: '/bots/../actions' })).toBeNull();
  });
});
