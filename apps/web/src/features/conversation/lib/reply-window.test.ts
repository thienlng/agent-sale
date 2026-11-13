import { describe, expect, it } from 'vitest';

import { replyWindowState } from './reply-window';

const at = '2026-11-01T00:00:00.000Z';
const hours = (h: number) => Date.parse(at) + h * 3_600_000;

describe('replyWindowState', () => {
  it('keeps Messenger and Instagram open for 24 hours, then closes them', () => {
    for (const provider of ['facebook', 'instagram'] as const) {
      expect(replyWindowState(provider, at, hours(23), false)).toBe('open');
      expect(replyWindowState(provider, at, hours(24), false)).toBe('closed');
    }
  });

  it('lets a member answer for 7 days with the HUMAN_AGENT tag', () => {
    expect(replyWindowState('facebook', at, hours(30), true)).toBe('human_agent');
    expect(replyWindowState('facebook', at, hours(24 * 7), true)).toBe('closed');
  });

  it('never locks a website conversation (MS-20)', () => {
    expect(replyWindowState('website', at, hours(24 * 30), false)).toBe('open');
    expect(replyWindowState('website', at, hours(48), true)).toBe('open');
  });
});
