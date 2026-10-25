import { describe, expect, it } from 'vitest';
import {
  followUpInputToIso,
  readFollowUpDraft,
  toLocalFollowUpInput,
  writeFollowUpDraft,
} from './follow-up-draft';

describe('follow-up drafts and device-local time', () => {
  it('round-trips local date input through an absolute timestamp', () => {
    const instant = new Date(2030, 0, 2, 15, 30).toISOString();
    expect(toLocalFollowUpInput(instant)).toBe('2030-01-02T15:30');
    expect(followUpInputToIso('2030-01-02T15:30')).toBe(instant);
  });
  it('rejects missing or normalized invalid dates rather than silently changing the reminder', () => {
    expect(followUpInputToIso('')).toBeNull();
    expect(followUpInputToIso('2030-02-30T15:30')).toBeNull();
    expect(toLocalFollowUpInput('invalid')).toBe('');
  });
  it('keeps drafts in their caller-provided user/workspace/conversation scope', () => {
    writeFollowUpDraft('user-a:workspace-a:conversation', {
      at: '2030-01-02T15:30',
      note: 'Call back',
      revision: 4,
    });
    expect(readFollowUpDraft('user-a:workspace-b:conversation')).toBeNull();
    expect(readFollowUpDraft('user-b:workspace-a:conversation')).toBeNull();
    expect(readFollowUpDraft('user-a:workspace-a:conversation')?.note).toBe('Call back');
  });
});
