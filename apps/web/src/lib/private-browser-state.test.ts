import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPrivateBrowserState,
  onPrivateStateCleared,
  privateStateVersion,
} from './private-browser-state';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('private browser state lifecycle', () => {
  it('clears private state while retaining personal settings', () => {
    localStorage.setItem('rapiz.private.inbox.draft.v1:test', 'Synthetic draft');
    localStorage.setItem('rapiz.inbox.enter.v1:user', 'false');
    const previous = privateStateVersion();
    clearPrivateBrowserState();
    expect(privateStateVersion()).toBeGreaterThan(previous);
    expect(localStorage.getItem('rapiz.private.inbox.draft.v1:test')).toBeNull();
    expect(localStorage.getItem('rapiz.inbox.enter.v1:user')).toBe('false');
  });

  it('invalidates memory callbacks even when storage removal is blocked', () => {
    const cleared = vi.fn();
    onPrivateStateCleared(cleared);
    localStorage.setItem('rapiz.private.test', 'Synthetic draft');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const previous = privateStateVersion();
    expect(() => clearPrivateBrowserState()).not.toThrow();
    expect(privateStateVersion()).toBeGreaterThan(previous);
    expect(cleared).toHaveBeenCalledOnce();
  });
});
