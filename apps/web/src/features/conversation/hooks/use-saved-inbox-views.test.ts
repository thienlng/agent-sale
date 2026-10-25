import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListState } from '../lib/inbox-list';
import {
  inboxViewFilters,
  parseSavedInboxViews,
  savedInboxViewKey,
  useSavedInboxViews,
} from './use-saved-inbox-views';

const filters: ListState = {
  q: 'private customer phone',
  provider: 'all',
  channelId: 'all',
  status: 'open',
  mode: 'all',
  order: 'newest',
  queue: 'due',
};
const view = { id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01', name: 'Follow-ups', filters };
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('saved inbox views', () => {
  it('strips search text and unsupported fields before persisting or restoring filters', () => {
    expect(inboxViewFilters(filters)).not.toHaveProperty('q');
    const parsed = parseSavedInboxViews(JSON.stringify([view]));
    expect(parsed[0]?.filters.queue).toBe('due');
    expect(parsed[0]?.filters).not.toHaveProperty('q');
  });
  it('rejects corrupt, oversized or unsupported saved settings', () => {
    expect(parseSavedInboxViews('{')).toEqual([]);
    expect(
      parseSavedInboxViews(
        JSON.stringify([{ ...view, filters: { ...filters, queue: 'unsupported' } }]),
      ),
    ).toEqual([]);
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...view,
      id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d0${i}`,
    }));
    expect(parseSavedInboxViews(JSON.stringify(many))).toHaveLength(5);
    expect(parseSavedInboxViews(JSON.stringify([view, view]))).toHaveLength(1);
  });
  it('keeps valid entries when another one is corrupt', () => {
    const bad = { ...view, id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02', name: '' };
    expect(parseSavedInboxViews(JSON.stringify([bad, view])).map((v) => v.id)).toEqual([view.id]);
    expect(parseSavedInboxViews(' '.repeat(20001))).toEqual([]);
  });
  it('isolates users and workspaces, restores filters, enforces the limit and deletes views', () => {
    const mine = renderHook(() => useSavedInboxViews('workspace-a', 'sale-a'));
    for (let i = 0; i < 5; i++)
      act(() => {
        expect(mine.result.current.save(`View ${i}`, filters)).toBe(true);
      });
    act(() => {
      expect(mine.result.current.save('Sixth', filters)).toBe(false);
    });
    expect(mine.result.current.views).toHaveLength(5);
    expect(localStorage.getItem(savedInboxViewKey('workspace-a', 'sale-a'))).not.toContain(
      'private customer phone',
    );
    const restored = renderHook(() => useSavedInboxViews('workspace-a', 'sale-a'));
    expect(restored.result.current.views[0]?.filters.queue).toBe('due');
    expect(
      renderHook(() => useSavedInboxViews('workspace-a', 'sale-b')).result.current.views,
    ).toEqual([]);
    expect(
      renderHook(() => useSavedInboxViews('workspace-b', 'sale-a')).result.current.views,
    ).toEqual([]);
    const first = mine.result.current.views[0];
    expect(first).toBeDefined();
    if (first)
      act(() => {
        mine.result.current.remove(first.id);
      });
    expect(mine.result.current.views).toHaveLength(4);
  });
  it('never carries saved views into a changed scope in the same mounted hook', () => {
    const hook = renderHook(({ workspaceId, userId }) => useSavedInboxViews(workspaceId, userId), {
      initialProps: { workspaceId: 'workspace-a', userId: 'sale-a' },
    });
    act(() => {
      hook.result.current.save('Private view', filters);
    });
    hook.rerender({ workspaceId: 'workspace-a', userId: 'sale-b' });
    expect(hook.result.current.views).toEqual([]);
    act(() => {
      hook.result.current.save('Other view', filters);
    });
    expect(hook.result.current.views.map((saved) => saved.name)).toEqual(['Other view']);
    hook.rerender({ workspaceId: 'workspace-a', userId: 'sale-a' });
    expect(hook.result.current.views.map((saved) => saved.name)).toEqual(['Private view']);
  });
  it('handles blocked reads without crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    const hook = renderHook(() => useSavedInboxViews('workspace-a', 'sale-a'));
    expect(hook.result.current.views).toEqual([]);
    expect(hook.result.current.error).toBe(true);
  });
  it('keeps the last saved state and exposes an actionable error when storage is blocked', () => {
    const hook = renderHook(() => useSavedInboxViews('workspace-a', 'sale-a'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    act(() => {
      expect(hook.result.current.save('Blocked', filters)).toBe(false);
    });
    expect(hook.result.current.error).toBe(true);
    expect(hook.result.current.views).toEqual([]);
  });
});
