import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tagBarKey, useTagBarExpanded } from './use-tag-bar-expanded';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('tag bar expanded state', () => {
  it('remembers the choice per user', () => {
    const first = renderHook(() => useTagBarExpanded('ws', 'me'));
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(localStorage.getItem(tagBarKey('ws', 'me'))).toBe('1');
    expect(renderHook(() => useTagBarExpanded('ws', 'me')).result.current[0]).toBe(true);
    expect(renderHook(() => useTagBarExpanded('ws', 'other')).result.current[0]).toBe(false);
  });

  it('still works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useTagBarExpanded('ws', 'me'));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
