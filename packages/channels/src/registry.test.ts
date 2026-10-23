import { describe, expect, it } from 'vitest';

import type { ChannelAdapter } from './adapter.js';
import { ChannelRegistry } from './registry.js';

const website: ChannelAdapter = {
  kind: 'website',
  verifyWebhook: () => true,
  parseWebhook: () => [],
  send: async () => ({ externalMessageId: 'm1' }),
  capabilities: () => ({
    richCards: true,
    quickReplies: true,
    media: true,
    replyWindowHours: null,
  }),
  mapError: () => ({ code: 'unknown', retryable: false }),
};

describe('ChannelRegistry', () => {
  it('registers and resolves adapters by kind', () => {
    const r = new ChannelRegistry().register(website);
    expect(r.get('website').kind).toBe('website');
    expect(r.kinds()).toEqual(['website']);
  });

  it('rejects duplicates and unknown kinds', () => {
    const r = new ChannelRegistry().register(website);
    expect(() => r.register(website)).toThrow('already registered');
    expect(() => r.get('zalo_oa')).toThrow('no adapter');
  });
});
