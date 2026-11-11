import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { peekPendingDraft, putPendingDraft, takePendingDraft } from '@/lib/pending-reply-draft';
import { clearPrivateBrowserState } from '@/lib/private-browser-state';

import { DraftPrefill } from './conversation-brain';

const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const CONV = '0190f5c2-0000-7000-8000-00000000c001';
const OTHER = '0190f5c2-0000-7000-8000-00000000c002';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));

afterEach(() => {
  takePendingDraft(WS, CONV, peekPendingDraft(WS, CONV) ?? '');
  takePendingDraft(WS, OTHER, peekPendingDraft(WS, OTHER) ?? '');
});

describe('DraftPrefill', () => {
  it('puts the waiting draft into the composer once, then drops it', () => {
    putPendingDraft(WS, CONV, 'Dạ shop gửi giá ạ.');
    const insert = vi.fn(() => true);
    const { rerender } = render(<DraftPrefill conversationId={CONV} insertText={insert} />);
    rerender(<DraftPrefill conversationId={CONV} insertText={() => true} />);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith('Dạ shop gửi giá ạ.');
    expect(peekPendingDraft(WS, CONV)).toBeUndefined();
  });

  it('keeps the draft when the composer refuses it, for the next time the conversation opens', () => {
    putPendingDraft(WS, CONV, 'Dạ shop gửi giá ạ.');
    const refuse = vi.fn(() => false);
    const first = render(<DraftPrefill conversationId={CONV} insertText={refuse} />);
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(peekPendingDraft(WS, CONV)).toBe('Dạ shop gửi giá ạ.');
    first.unmount();
    const accept = vi.fn(() => true);
    render(<DraftPrefill conversationId={CONV} insertText={accept} />);
    expect(accept).toHaveBeenCalledWith('Dạ shop gửi giá ạ.');
    expect(peekPendingDraft(WS, CONV)).toBeUndefined();
  });

  it("inserts nothing for another conversation and leaves that one's draft", () => {
    putPendingDraft(WS, OTHER, 'Cho conversation khác');
    const insert = vi.fn(() => true);
    render(<DraftPrefill conversationId={CONV} insertText={insert} />);
    expect(insert).not.toHaveBeenCalled();
    expect(peekPendingDraft(WS, OTHER)).toBe('Cho conversation khác');
  });

  it('forgets every waiting draft on logout', () => {
    putPendingDraft(WS, CONV, 'Bí mật');
    clearPrivateBrowserState();
    expect(peekPendingDraft(WS, CONV)).toBeUndefined();
  });
});
