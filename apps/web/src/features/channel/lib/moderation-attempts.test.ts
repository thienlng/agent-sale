import { afterEach, describe, expect, it } from 'vitest';
import {
  beginModeration,
  clearModeration,
  moderationKey,
  readModeration,
  settleModeration,
} from './moderation-attempts';

const key = moderationKey({ userId: 'u', workspaceId: 'w', connectionId: 'p', commentId: '1_2' });
let n = 0;
const id = () => `id-${++n}`;
afterEach(clearModeration);

describe('moderation attempts', () => {
  it('keeps an open attempt’s request id and refuses the opposite operation', () => {
    const first = beginModeration(key, 'hide', id)!;
    expect(beginModeration(key, 'hide', id)).toBeNull(); // still in flight
    settleModeration(key, first.requestId, 'unconfirmed');
    expect(beginModeration(key, 'unhide', id)).toBeNull();
    settleModeration(key, first.requestId, 'pending');
    expect(beginModeration(key, 'unhide', id)).toBeNull();
    expect(beginModeration(key, 'hide', id)?.requestId).toBe(first.requestId);
  });

  it('allows a fresh request once the attempt is final, and ignores foreign outcomes', () => {
    const first = beginModeration(key, 'hide', id)!;
    settleModeration(key, 'someone-else', 'sent');
    expect(readModeration(key)?.state).toBe('sending');
    settleModeration(key, first.requestId, 'sent');
    expect(readModeration(key)).toBeNull();
    const second = beginModeration(key, 'unhide', id)!;
    settleModeration(key, second.requestId, 'failed');
    expect(beginModeration(key, 'hide', id)?.requestId).not.toBe(second.requestId);
  });
});
