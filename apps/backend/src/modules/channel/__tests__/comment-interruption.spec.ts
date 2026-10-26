import { describe, it, expect } from 'vitest';
import { interruptsComment } from '../domain/comment-interruption.js';
const c = {
  commentId: '10_20',
  version: '2026-10-25T10:00:00.000Z/0/event1',
  actions: [{ kind: 'public_reply', status: 'sent', text: 'Hello', externalId: '20_30' }],
};
const event = {
  externalEventId: 'event2',
  senderExternalId: '123',
  occurredAt: '2026-10-25T10:00:01.000Z',
  text: 'Staff reply',
  comment: { commentId: '20_31', parentId: '10_20', operation: 'add' },
};
describe('Comment interruption', () => {
  it('pauses for a staff reply but ignores the bot public-reply echo', () => {
    expect(interruptsComment(c, event, '123')).toBe(true);
    expect(
      interruptsComment(c, { ...event, comment: { ...event.comment, commentId: '20_30' } }, '123'),
    ).toBe(false);
  });
  it('recognizes a pending or uncertain bot reply by exact text', () => {
    expect(
      interruptsComment(
        {
          ...c,
          actions: [
            { kind: 'public_reply', status: 'unknown', text: 'Staff reply', externalId: null },
          ],
        },
        event,
        '123',
      ),
    ).toBe(false);
  });
  it('invalidates newer edits including those at the same provider timestamp', () => {
    const edit = {
      ...event,
      senderExternalId: '999',
      comment: { commentId: '10_20', parentId: null, operation: 'edited' },
    };
    expect(interruptsComment(c, edit, '123')).toBe(true);
    expect(interruptsComment(c, { ...edit, occurredAt: '2026-10-25T10:00:00.000Z' }, '123')).toBe(
      true,
    );
    expect(interruptsComment(c, { ...edit, occurredAt: '2026-10-25T09:59:59.000Z' }, '123')).toBe(
      false,
    );
  });
});
