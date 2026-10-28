import { afterEach, describe, expect, it } from 'vitest';

import {
  beginAttempt,
  clearAll,
  draftKey,
  readDraft,
  setDraftText,
  settleAttempt,
} from './comment-drafts';

const scope = { userId: 'u', workspaceId: 'w', connectionId: 'p', commentId: '1_2' };
const pub = draftKey({ ...scope, mode: 'public_reply' });
const priv = draftKey({ ...scope, mode: 'private_reply' });
let n = 0;
const ids = () => `req-${++n}`;
afterEach(clearAll);

describe('comment drafts', () => {
  it('keeps public, private, comment and user drafts apart', () => {
    setDraftText(pub, 'public text');
    setDraftText(priv, 'private text');
    setDraftText(draftKey({ ...scope, commentId: '1_3', mode: 'public_reply' }), 'other');
    expect(readDraft(pub).text).toBe('public text');
    expect(readDraft(priv).text).toBe('private text');
    expect(readDraft(draftKey({ ...scope, userId: 'v', mode: 'public_reply' })).text).toBe('');
  });

  it('reuses the request id only to retry an unconfirmed attempt, and locks its text', () => {
    setDraftText(pub, 'Hi');
    const first = beginAttempt(pub, ids)!;
    expect(beginAttempt(pub, ids)).toBeNull();
    settleAttempt(pub, first.requestId, 'unconfirmed');
    setDraftText(pub, 'Edited');
    expect(readDraft(pub).text).toBe('Hi');
    const retry = beginAttempt(pub, ids)!;
    expect(retry.requestId).toBe(first.requestId);
    settleAttempt(pub, retry.requestId, 'failed');
    expect(beginAttempt(pub, ids)!.requestId).not.toBe(first.requestId);
  });

  it('clears only the matching draft once its own attempt is confirmed', () => {
    setDraftText(pub, 'Hi');
    setDraftText(priv, 'Keep me');
    const attempt = beginAttempt(pub, ids)!;
    // A late answer for an older attempt does nothing.
    settleAttempt(pub, 'stale', 'sent');
    expect(readDraft(pub).text).toBe('Hi');
    settleAttempt(pub, attempt.requestId, 'sent');
    expect(readDraft(pub)).toMatchObject({ text: '', attempt: null });
    expect(readDraft(priv).text).toBe('Keep me');
  });

  it('keeps the text after a refusal or an unknown outcome', () => {
    setDraftText(priv, 'Xin chào');
    const attempt = beginAttempt(priv, ids)!;
    settleAttempt(priv, attempt.requestId, 'unknown');
    expect(readDraft(priv)).toMatchObject({ text: 'Xin chào', attempt: { state: 'unknown' } });
    setDraftText(priv, 'Xin chào bạn');
    expect(readDraft(priv).text).toBe('Xin chào bạn');
  });
});
