import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldIgnoreInboxShortcut, useInboxShortcuts } from './use-inbox-shortcuts';

afterEach(() => {
  document.body.replaceChildren();
});
function key(target: Element | Window, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

describe('inbox keyboard shortcuts', () => {
  it('moves through visible conversations only and focuses search without wrapping at boundaries', () => {
    const onSelect = vi.fn();
    const onSearch = vi.fn();
    const hook = renderHook(
      ({ selected }: { selected: string | null }) =>
        useInboxShortcuts({ ids: ['a', 'c'], selected, onSelect, onSearch }),
      { initialProps: { selected: null as string | null } },
    );
    act(() => {
      key(window, 'j');
    });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    hook.rerender({ selected: 'a' });
    act(() => {
      key(window, 'j');
    });
    expect(onSelect).toHaveBeenLastCalledWith('c');
    hook.rerender({ selected: 'c' });
    onSelect.mockClear();
    act(() => {
      key(window, 'j');
    });
    expect(onSelect).not.toHaveBeenCalled();
    act(() => {
      key(window, 'k');
      key(window, '/');
    });
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onSearch).toHaveBeenCalledOnce();
  });
  it('does not hijack editors, comboboxes, dialogs, composition or modified/repeated keys', () => {
    const onSelect = vi.fn();
    const onSearch = vi.fn();
    renderHook(() => useInboxShortcuts({ ids: ['a'], selected: null, onSelect, onSearch }));
    for (const tag of ['input', 'textarea', 'select']) {
      const editor = document.createElement(tag);
      document.body.append(editor);
      key(editor, 'j');
      key(editor, '/');
      editor.remove();
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    document.body.append(editable);
    key(child, 'j');
    editable.remove();
    const combo = document.createElement('button');
    combo.setAttribute('role', 'combobox');
    document.body.append(combo);
    key(combo, 'j');
    combo.remove();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    key(window, 'j');
    dialog.remove();
    for (const options of [
      { ctrlKey: true },
      { shiftKey: true },
      { metaKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
    ])
      key(window, 'j', options);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
    expect(shouldIgnoreInboxShortcut(new KeyboardEvent('keydown', { key: 'j' }))).toBe(false);
  });
});
