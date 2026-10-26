import { describe, expect, it } from 'vitest';
import { draftKey, insertQuickReply, readDraft, writeDraft } from './composer-draft';

describe('conversation composer drafts', () => {
  it('restores text and an attachment after visiting another conversation', () => {
    const first = draftKey('sale-a', 'workspace-a', 'first');
    const second = draftKey('sale-a', 'workspace-a', 'second');
    const draft = {
      text: 'Checking the size',
      attachment: { type: 'image' as const, url: 'https://shop.example/photo.jpg' },
      attempt: null,
    };
    writeDraft(first, draft);
    writeDraft(second, { text: 'Other customer', attachment: null, attempt: null });
    expect(readDraft(first)).toEqual(draft);
    expect(readDraft(draftKey('sale-a', 'workspace-b', 'first')).text).toBe('');
    expect(readDraft(draftKey('sale-b', 'workspace-a', 'first')).text).toBe('');
  });

  it('inserts a quick reply at the caret and preserves the surrounding draft', () => {
    expect(insertQuickReply('Hello , thanks', 'Lan', 6, 6)).toEqual({
      text: 'Hello Lan, thanks',
      cursor: 9,
    });
    expect(insertQuickReply('Hello customer', 'Lan', 6, 14)).toEqual({
      text: 'Hello Lan',
      cursor: 9,
    });
  });

  it('refuses an oversized quick reply without truncating the existing draft', () => {
    expect(insertQuickReply('x'.repeat(1999), 'hello', 0, 0)).toBeNull();
  });

  it('retains the attempted request id across a remount so retries do not duplicate sends', () => {
    const key = draftKey('sale-retry', 'workspace-a', 'first');
    const attempt = { text: 'Hello', idempotencyKey: crypto.randomUUID() };
    writeDraft(key, { text: 'Hello', attachment: null, attempt });
    expect(readDraft(key).attempt).toEqual(attempt);
    writeDraft(key, { text: '', attachment: null, attempt: null });
    expect(readDraft(key).attempt).toBeNull();
  });
});
