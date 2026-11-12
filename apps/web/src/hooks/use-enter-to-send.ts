import { type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';

const LINE_BREAKS = new Set(['insertLineBreak', 'insertParagraph']);

/**
 * Enter sends, Shift+Enter or Alt+Enter breaks the line (browsers insert nothing on Alt+Enter, so
 * the hook inserts the line break itself, undoable like typing). A phone keyboard's return key (iOS with a Vietnamese
 * layout, Android IMEs) arrives mid-composition or with no usable keydown, so the line break it
 * would insert is also caught at `beforeinput` and turned into a send. Spread the returned props
 * on the textarea that `ref` points to; `onSend` must check by itself whether sending is allowed.
 */
export function useEnterToSend(ref: RefObject<HTMLTextAreaElement | null>, onSend: () => void) {
  const send = useRef(onSend);
  const shift = useRef(false);
  useEffect(() => {
    send.current = onSend;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (event: InputEvent) => {
      if (shift.current || !LINE_BREAKS.has(event.inputType)) return;
      event.preventDefault();
      send.current();
    };
    el.addEventListener('beforeinput', onBeforeInput);
    return () => el.removeEventListener('beforeinput', onBeforeInput);
  }, [ref]);

  return {
    enterKeyHint: 'send' as const,
    onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      shift.current = event.shiftKey;
      // A Vietnamese IME confirms its word with Enter: never send mid-composition.
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
      if (event.altKey) {
        event.preventDefault();
        insertLineBreak(event.currentTarget);
        return;
      }
      event.preventDefault();
      send.current();
    },
    onKeyUp(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === 'Shift') shift.current = false;
    },
  };
}

/**
 * Inserts "\n" at the caret as typed text: `insertText` keeps the browser's undo and fires the
 * input event React listens to; where it is unavailable, the value is set through the native
 * setter and an input event is dispatched so a controlled textarea still sees the change.
 */
function insertLineBreak(el: HTMLTextAreaElement): void {
  el.focus();
  if (document.execCommand?.('insertText', false, '\n')) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  const next = `${value.slice(0, start)}\n${value.slice(end)}`;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, next);
  el.setSelectionRange(start + 1, start + 1);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
