import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useEnterToSend } from './use-enter-to-send';

function Box({ onSend }: { onSend: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const props = useEnterToSend(ref, onSend);
  return <textarea ref={ref} aria-label="box" {...props} />;
}

function lineBreak(el: HTMLElement) {
  const event = new InputEvent('beforeinput', {
    inputType: 'insertLineBreak',
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
  return event;
}

describe('useEnterToSend', () => {
  it('sends on Enter and leaves Shift+Enter and composing Enter alone', () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'box' });
    expect(box).toHaveAttribute('enterkeyhint', 'send');

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('breaks the line at the caret on Alt+Enter instead of sending', () => {
    const onSend = vi.fn();
    function Controlled() {
      const [text, setText] = useState('ab');
      const ref = useRef<HTMLTextAreaElement>(null);
      const props = useEnterToSend(ref, onSend);
      return (
        <textarea
          ref={ref}
          aria-label="box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          {...props}
        />
      );
    }
    render(<Controlled />);
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'box' });
    box.setSelectionRange(1, 1);
    fireEvent.keyDown(box, { key: 'Enter', altKey: true });
    expect(box.value).toBe('a\nb');
    expect(onSend).not.toHaveBeenCalled();
  });

  it("turns a phone keyboard's line break into a send", () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'box' });

    expect(lineBreak(box).defaultPrevented).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('keeps the line break while Shift is held', () => {
    const onSend = vi.fn();
    render(<Box onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'box' });

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(lineBreak(box).defaultPrevented).toBe(false);
    fireEvent.keyUp(box, { key: 'Shift' });
    expect(lineBreak(box).defaultPrevented).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
