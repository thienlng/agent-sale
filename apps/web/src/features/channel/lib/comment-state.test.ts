import type { FanpageAction } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { postLink, privateReplyState, visibility } from './comment-state';

const action = (
  kind: FanpageAction['kind'],
  status: FanpageAction['status'],
  minute: number,
): FanpageAction => ({
  id: crypto.randomUUID(),
  kind,
  status,
  text: '',
  reason: 'Manual staff action',
  externalId: null,
  actorId: null,
  recipientId: null,
  failureCode: null,
  createdAt: new Date(Date.UTC(2026, 9, 27, 10, minute)).toISOString(),
});

describe('visibility', () => {
  it('follows the newest recorded outcome and never assumes an uncertain one', () => {
    expect(visibility({ actions: [] })).toBe('visible');
    expect(visibility({ actions: [action('hide', 'sent', 1)] })).toBe('hidden');
    expect(visibility({ actions: [action('unhide', 'sent', 2), action('hide', 'sent', 1)] })).toBe(
      'visible',
    );
    expect(
      visibility({ actions: [action('hide', 'sent', 1), action('unhide', 'unknown', 2)] }),
    ).toBe('uncertain');
    expect(visibility({ actions: [action('hide', 'pending', 1)] })).toBe('uncertain');
    // A rejected attempt changed nothing on Facebook.
    expect(
      visibility({ actions: [action('hide', 'sent', 1), action('unhide', 'failed', 2)] }),
    ).toBe('hidden');
  });
});

describe('privateReplyState', () => {
  const now = Date.UTC(2026, 9, 27, 12);
  const base = { deleted: false, occurredAt: new Date(now - 3600000).toISOString(), actions: [] };
  it('allows one attempt within seven days of the comment', () => {
    expect(privateReplyState(base, now)).toBe('available');
    expect(
      privateReplyState({ ...base, actions: [action('private_reply', 'unknown', 1)] }, now),
    ).toBe('attempted');
    expect(
      privateReplyState({ ...base, actions: [action('private_reply', 'failed', 1)] }, now),
    ).toBe('available');
    expect(
      privateReplyState({ ...base, occurredAt: new Date(now - 7 * 86400000).toISOString() }, now),
    ).toBe('expired');
    expect(privateReplyState({ ...base, deleted: true }, now)).toBe('deleted');
  });
});

describe('postLink', () => {
  it('keeps Facebook https permalinks and falls back to the post id otherwise', () => {
    expect(postLink('1_2', 'https://www.facebook.com/shop/posts/2')).toBe(
      'https://www.facebook.com/shop/posts/2',
    );
    expect(postLink('1_2', 'javascript:alert(1)')).toBe('https://www.facebook.com/1_2');
    expect(postLink('1_2', 'https://evil.example/facebook.com')).toBe(
      'https://www.facebook.com/1_2',
    );
    expect(postLink('1_2', 'https://notfacebook.com/x')).toBe('https://www.facebook.com/1_2');
    expect(postLink('1_2', 'https://u:p@www.facebook.com/x')).toBe('https://www.facebook.com/1_2');
    expect(postLink('1_2')).toBe('https://www.facebook.com/1_2');
  });
});
