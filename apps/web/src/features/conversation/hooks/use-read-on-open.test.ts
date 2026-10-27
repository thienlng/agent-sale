import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markUnreadGuarded, useReadOnOpen } from './use-read-on-open';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(),
  markUnread: vi.fn(() => Promise.resolve()),
}));
vi.mock('../api/inbox', () => ({
  useReadState: () => ({
    markRead: { mutate: mocks.markRead },
    markUnread: { mutateAsync: mocks.markUnread, isPending: false },
  }),
}));

type Read = { unreadCount: number; lastReadAt: string | null };
const unread: Read = { unreadCount: 2, lastReadAt: null };
const read: Read = { unreadCount: 0, lastReadAt: '2026-10-25T10:00:00.000Z' };

beforeEach(() => {
  mocks.markRead.mockReset();
  mocks.markUnread.mockClear();
});

describe('read on open', () => {
  it('marks an unread conversation read once when it opens', () => {
    const { rerender } = renderHook((c: Read | undefined) => useReadOnOpen('c1', c), {
      initialProps: unread,
    });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
    expect(mocks.markRead).toHaveBeenCalledWith('c1');
    rerender({ ...unread });
    rerender({ ...unread });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });

  it('marks a conversation nobody has read yet, even without an unread count', () => {
    renderHook(() => useReadOnOpen('c1', { unreadCount: 0, lastReadAt: null }));
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a conversation that is already read', () => {
    renderHook(() => useReadOnOpen('c1', read));
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('waits for the conversation to load', () => {
    const { rerender } = renderHook((c: Read | undefined) => useReadOnOpen('c1', c), {
      initialProps: undefined as Read | undefined,
    });
    expect(mocks.markRead).not.toHaveBeenCalled();
    rerender(unread);
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });

  it('marks read again when more customer messages arrive while open', () => {
    const { rerender } = renderHook((c: Read) => useReadOnOpen('c1', c), { initialProps: unread });
    rerender(read);
    rerender({ unreadCount: 1, lastReadAt: read.lastReadAt });
    expect(mocks.markRead).toHaveBeenCalledTimes(2);
  });

  it('does not undo an explicit mark-unread of the open conversation', async () => {
    const { result, rerender } = renderHook((c: Read) => useReadOnOpen('c1', c), {
      initialProps: read,
    });
    await result.current.markUnread();
    expect(mocks.markUnread).toHaveBeenCalledWith('c1');
    rerender({ unreadCount: 1, lastReadAt: null });
    expect(mocks.markRead).not.toHaveBeenCalled();
    rerender({ unreadCount: 2, lastReadAt: null });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });

  it('does not undo a mark-unread made from the list row on the open conversation', async () => {
    const { rerender } = renderHook((c: Read) => useReadOnOpen('c-row', c), { initialProps: read });
    await markUnreadGuarded('c-row', mocks.markUnread);
    rerender({ unreadCount: 1, lastReadAt: null });
    expect(mocks.markRead).not.toHaveBeenCalled();
    rerender({ unreadCount: 2, lastReadAt: null });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });

  it('releases the guard when the mark-unread request fails', async () => {
    const { rerender } = renderHook((c: Read) => useReadOnOpen('c-fail', c), {
      initialProps: read,
    });
    await expect(
      markUnreadGuarded('c-fail', () => Promise.reject(new Error('403'))),
    ).rejects.toThrow();
    rerender({ unreadCount: 2, lastReadAt: read.lastReadAt });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });

  it('waits for the tab to be visible, then marks read', () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderHook(() => useReadOnOpen('c-hidden', unread));
    expect(mocks.markRead).not.toHaveBeenCalled();
    state.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
    expect(mocks.markRead).toHaveBeenCalledWith('c-hidden');
    state.mockRestore();
  });

  it('marks a read conversation when a new lead appears on it, once', () => {
    type WithLead = Read & { lead: { seenAt: string | null } | null };
    const lead = { seenAt: null };
    const { rerender } = renderHook((c: WithLead) => useReadOnOpen('c1', c as never), {
      initialProps: { ...read, lead: null } as WithLead,
    });
    expect(mocks.markRead).not.toHaveBeenCalled();
    rerender({ ...read, lead });
    rerender({ ...read, lead });
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });
});
