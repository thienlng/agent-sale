import { useEffect } from 'react';

/** Do not intercept typing, modal workflows or browser/OS key combinations. */
export function shouldIgnoreInboxShortcut(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    event.repeat ||
    event.isComposing
  )
    return true;
  if (
    document.querySelector(
      '[role="dialog"]:not([hidden]):not([data-state="closed"]), [role="alertdialog"]:not([hidden]):not([data-state="closed"]), dialog[open], [role="listbox"]:not([hidden]), [role="menu"]:not([hidden])',
    )
  )
    return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="dialog"], [role="alertdialog"]',
    ),
  );
}

export function useInboxShortcuts({
  ids,
  selected,
  onSelect,
  onSearch,
}: {
  ids: readonly string[];
  selected: string | null;
  onSelect: (id: string) => void;
  onSearch: () => void;
}): void {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (shouldIgnoreInboxShortcut(event)) return;
      if (event.key === '/') {
        event.preventDefault();
        onSearch();
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      const index = selected ? ids.indexOf(selected) : -1;
      const next = index < 0 ? (key === 'j' ? 0 : ids.length - 1) : index + (key === 'j' ? 1 : -1);
      const id = ids[next];
      if (id) {
        event.preventDefault();
        onSelect(id);
      }
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [ids, selected, onSelect, onSearch]);
}
