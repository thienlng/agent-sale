import { useState } from 'react';

export function tagBarKey(workspaceId: string, userId: string): string {
  return `rapiz.inbox.tagbar:${encodeURIComponent(workspaceId)}:${encodeURIComponent(userId)}`;
}

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Whether the tag bar shows the full tag grid, remembered per user; storage may be unavailable. */
export function useTagBarExpanded(
  workspaceId: string,
  userId: string,
): [boolean, (expanded: boolean) => void] {
  const key = tagBarKey(workspaceId, userId);
  const [state, setState] = useState(() => ({ key, expanded: read(key) }));
  const expanded = state.key === key ? state.expanded : read(key);
  function set(next: boolean) {
    setState({ key, expanded: next });
    try {
      window.localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // The choice still applies for this session.
    }
  }
  return [expanded, set];
}
