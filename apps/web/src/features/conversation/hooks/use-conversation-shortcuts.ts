import { type RefObject, useEffect } from 'react';
import { shouldIgnoreInboxShortcut } from './use-inbox-shortcuts';

function isVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

/**
 * E toggles completion, R focuses the currently visible reply or private-note editor,
 * T opens the tag picker and U marks the conversation unread.
 */
export function useConversationShortcuts({
  root,
  enabled,
  busy,
  onToggleResolved,
  onOpenTags,
  onMarkUnread,
}: {
  root: RefObject<HTMLElement | null>;
  enabled: boolean;
  busy: boolean;
  onToggleResolved: () => void;
  onOpenTags?: (() => void) | undefined;
  onMarkUnread?: (() => void) | undefined;
}): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!enabled || !root.current || shouldIgnoreInboxShortcut(event)) return;
      if (event.key.toLowerCase() === 'e' && !busy) {
        event.preventDefault();
        onToggleResolved();
      } else if (event.key.toLowerCase() === 't' && onOpenTags) {
        event.preventDefault();
        onOpenTags();
      } else if (event.key.toLowerCase() === 'u' && onMarkUnread && !busy) {
        event.preventDefault();
        onMarkUnread();
      } else if (event.key.toLowerCase() === 'r') {
        const editor = root.current.querySelector<HTMLTextAreaElement>(
          '[data-inbox-composer] textarea:not([disabled])',
        );
        if (editor && isVisible(editor)) {
          event.preventDefault();
          editor.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [root, enabled, busy, onToggleResolved, onOpenTags, onMarkUnread]);
}
