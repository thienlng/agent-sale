import { type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';

const LINE_BREAKS = new Set(['insertLineBreak', 'insertParagraph']);

/**
 * Enter sends, Shift+Enter breaks the line. A phone keyboard's return key (iOS with a Vietnamese
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
      event.preventDefault();
      send.current();
    },
    onKeyUp(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (event.key === 'Shift') shift.current = false;
    },
  };
}
