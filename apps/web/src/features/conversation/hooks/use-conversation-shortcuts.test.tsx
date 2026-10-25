import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useConversationShortcuts } from './use-conversation-shortcuts';

function Harness({
  toggle,
  busy = false,
  hidden = false,
}: {
  toggle: () => void;
  busy?: boolean;
  hidden?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useConversationShortcuts({ root, enabled: true, busy, onToggleResolved: toggle });
  return (
    <div ref={root}>
      <input aria-label="Search" />
      <div data-inbox-composer style={hidden ? { display: 'none' } : undefined}>
        <textarea aria-label="Active composer" />
      </div>
    </div>
  );
}

describe('conversation keyboard shortcuts', () => {
  it('uses E for completion and R for the visible composer without sending a message', () => {
    const toggle = vi.fn();
    render(<Harness toggle={toggle} />);
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(toggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(screen.getByLabelText('Active composer')).toHaveFocus();
  });
  it('ignores editors, modifier combinations, repeat and open dialogs', () => {
    const toggle = vi.fn();
    const view = render(<Harness toggle={toggle} />);
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'e' });
    fireEvent.keyDown(screen.getByLabelText('Active composer'), { key: 'e' });
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'e', shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'e', repeat: true });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    fireEvent.keyDown(document.body, { key: 'e' });
    dialog.remove();
    expect(toggle).not.toHaveBeenCalled();
    view.rerender(<Harness toggle={toggle} busy />);
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(toggle).not.toHaveBeenCalled();
  });
  it('does not focus a composer hidden behind the customer panel', () => {
    render(<Harness toggle={vi.fn()} hidden />);
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(screen.getByLabelText('Active composer')).not.toHaveFocus();
  });
});
