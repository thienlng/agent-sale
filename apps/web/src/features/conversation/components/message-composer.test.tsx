import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { MessageComposer } from './message-composer';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  update: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { id: 'sale' }, workspaceId: 'workspace' }),
}));
vi.mock('../api/inbox', () => ({
  useInboxActions: () => ({
    send: { mutateAsync: mocks.send, isPending: false, isError: false },
    update: { mutateAsync: mocks.update, isPending: false },
  }),
  useQuickReplies: () => ({
    data: [
      { id: 'quick', title: 'Size guide', content: 'Size M' },
      { id: 'ship', title: 'Shipping', content: 'Free ship over 500k' },
    ],
  }),
}));
vi.mock('./message-attachments', () => ({
  AttachmentPicker: ({ onPick }: { onPick: (a: { type: 'image'; url: string }) => void }) => (
    <button onClick={() => onPick({ type: 'image', url: 'https://example.com/photo.jpg' })}>
      Pick photo
    </button>
  ),
}));

beforeEach(() => {
  mocks.send.mockReset();
  mocks.update.mockReset();
  mocks.invalidate.mockReset();
  mocks.toastError.mockReset();
});

describe('MessageComposer', () => {
  it('keeps each customer draft when switching conversations', async () => {
    const user = userEvent.setup();
    const view = render(<MessageComposer id="draft-first" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'First customer');
    view.rerender(<MessageComposer id="draft-second" botId="bot" windowClosed={false} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'Second customer');
    view.rerender(<MessageComposer id="draft-first" botId="bot" windowClosed={false} />);
    expect(screen.getByRole('textbox')).toHaveValue('First customer');
  });

  it('inserts a quick reply without replacing the surrounding customer draft', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="quick-insert" botId="bot" windowClosed={false} />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(editor, 'Hello , thanks');
    editor.setSelectionRange(6, 6);
    fireEvent.select(editor);
    await user.click(screen.getByRole('button', { name: 'channelInbox.quickReplies' }));
    await user.click(await screen.findByText('Size guide'));
    expect(editor).toHaveValue('Hello Size M, thanks');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('updates a remounted composer when its earlier send completes', async () => {
    const user = userEvent.setup();
    let finish: ((value: { status: string }) => void) | undefined;
    mocks.send.mockImplementation(
      () =>
        new Promise<{ status: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<MessageComposer id="in-flight-first" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Sending');
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    view.rerender(<MessageComposer id="in-flight-other" botId="bot" windowClosed={false} />);
    view.rerender(<MessageComposer id="in-flight-first" botId="bot" windowClosed={false} />);
    expect(screen.getByRole('textbox')).toHaveValue('Sending');
    finish?.({ status: 'sent' });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('does not clear a newly edited draft when an earlier send completes after switching customers', async () => {
    const user = userEvent.setup();
    let finish: ((value: { status: string }) => void) | undefined;
    mocks.send.mockImplementation(
      () =>
        new Promise<{ status: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<MessageComposer id="in-flight-edit" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Old text');
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    view.rerender(<MessageComposer id="in-flight-edit-other" botId="bot" windowClosed={false} />);
    view.rerender(<MessageComposer id="in-flight-edit" botId="bot" windowClosed={false} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New draft' } });
    finish?.({ status: 'sent' });
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('New draft'));
  });

  it('lets an external product tool insert text at the caret without sending or replacing the draft', async () => {
    const user = userEvent.setup();
    render(
      <MessageComposer
        id="external-product-insert"
        botId="bot"
        windowClosed={false}
        renderTools={(insertText) => (
          <button onClick={() => insertText('Oxford / M — 500,000 VND')}>Share product</button>
        )}
      />,
    );
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(editor, 'Hello , thanks');
    editor.setSelectionRange(6, 6);
    fireEvent.select(editor);
    await user.click(screen.getByRole('button', { name: 'Share product' }));
    expect(editor).toHaveValue('Hello Oxford / M — 500,000 VND, thanks');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('inserts after filled text when the editor did not emit a selection event before opening a tool', async () => {
    const user = userEvent.setup();
    render(
      <MessageComposer
        id="filled-product-insert"
        botId="bot"
        windowClosed={false}
        renderTools={(insertText) => (
          <button onClick={() => insertText('Oxford / M')}>Share filled product</button>
        )}
      />,
    );
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.focus();
    fireEvent.change(editor, { target: { value: 'Please see: ' } });
    // Filling text can update the DOM caret without dispatching a select event.
    editor.setSelectionRange(editor.value.length, editor.value.length);
    await user.click(screen.getByRole('button', { name: 'Share filled product' }));
    expect(editor).toHaveValue('Please see: Oxford / M');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('captures a moved caret on blur before opening quick replies without a select event', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="blur-quick-insert" botId="bot" windowClosed={false} />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.focus();
    fireEvent.change(editor, { target: { value: 'Hello , thanks' } });
    editor.setSelectionRange(6, 6);
    fireEvent.blur(editor);
    await user.click(screen.getByRole('button', { name: 'channelInbox.quickReplies' }));
    await user.click(await screen.findByText('Size guide'));
    expect(editor).toHaveValue('Hello Size M, thanks');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('refuses an external tool insertion exceeding the channel draft limit', async () => {
    const user = userEvent.setup();
    render(
      <MessageComposer
        id="external-product-too-long"
        botId="bot"
        windowClosed={false}
        renderTools={(insertText) => (
          <button onClick={() => insertText('x'.repeat(2001))}>Share long product</button>
        )}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this draft' } });
    await user.click(screen.getByRole('button', { name: 'Share long product' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this draft');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('stages an attachment until the operator explicitly sends it', async () => {
    const user = userEvent.setup();
    mocks.send.mockResolvedValue({ status: 'sent' });
    render(<MessageComposer id="attachment" botId="bot" windowClosed={false} />);
    await user.click(screen.getByText('Pick photo'));
    expect(mocks.send).not.toHaveBeenCalled();
    await user.click(screen.getByText('channelInbox.sales.sendAttachment'));
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '',
        attachment: { type: 'image', url: 'https://example.com/photo.jpg' },
      }),
    );
  });

  it('keeps a definitively failed text and explicitly retries with a new request key', async () => {
    const user = userEvent.setup();
    mocks.send.mockResolvedValue({ status: 'failed' });
    render(<MessageComposer id="failed-text" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Keep this');
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    expect(screen.getByRole('textbox')).toHaveValue('Keep this');
    await user.click(screen.getByRole('button', { name: 'channelInbox.sales.retrySend' }));
    expect(mocks.send.mock.calls[1]?.[0].idempotencyKey).not.toEqual(
      mocks.send.mock.calls[0]?.[0].idempotencyKey,
    );
  });

  it('reuses the request key after an unconfirmed network error', async () => {
    const user = userEvent.setup();
    mocks.send.mockRejectedValue(new Error('Network disconnected'));
    render(<MessageComposer id="network-error" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Keep for safe retry');
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    expect(mocks.send.mock.calls[1]?.[0]).toEqual(mocks.send.mock.calls[0]?.[0]);
  });

  it('preserves an unconfirmed text request key while staging an attachment', async () => {
    const user = userEvent.setup();
    mocks.send.mockRejectedValue(new Error('Network disconnected'));
    render(<MessageComposer id="network-with-attachment" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Safe text retry');
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    await user.click(screen.getByText('Pick photo'));
    await user.click(screen.getByRole('button', { name: 'channelInbox.send' }));
    expect(mocks.send.mock.calls[1]?.[0]).toEqual(mocks.send.mock.calls[0]?.[0]);
  });

  it('opens quick replies when the draft starts with "/" and filters by the text after it', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="slash-filter" botId="bot" windowClosed={false} />);
    const editor = screen.getByRole('textbox');
    await user.type(editor, '/');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.type(editor, 'ship');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'ShippingFree ship over 500k',
    ]);
    await user.clear(editor);
    await user.type(editor, 'hello /');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('inserts the highlighted quick reply on Enter instead of sending', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="slash-enter" botId="bot" windowClosed={false} />);
    const editor = screen.getByRole('textbox');
    await user.type(editor, '/');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(editor).toHaveValue('Free ship over 500k');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('inserts a quick reply on click and closes the list on Escape', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="slash-click" botId="bot" windowClosed={false} />);
    const editor = screen.getByRole('textbox');
    await user.type(editor, '/');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.type(editor, 's');
    await user.click(screen.getByRole('option', { name: /Size guide/ }));
    expect(editor).toHaveValue('Size M');
  });

  it('does not open quick replies for a page without a bot', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="slash-nobot" botId={null} windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), '/');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('sends the literal text when no quick reply matches the typed /word', async () => {
    const user = userEvent.setup();
    mocks.send.mockResolvedValue({ status: 'sent' });
    render(<MessageComposer id="slash-literal" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), '/zzz{Enter}');
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({ text: '/zzz' });
  });

  it('hints at the / shortcut when the empty composer is focused', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="slash-hint" botId="bot" windowClosed={false} />);
    const editor = screen.getByRole('textbox');
    expect(editor).toHaveAttribute('placeholder', 'channelInbox.composer');
    await user.click(editor);
    expect(editor).toHaveAttribute('placeholder', 'channelInbox.v2.slash.hint');
  });

  it('is only the textarea row: no mode tabs and no hint paragraphs', () => {
    render(<MessageComposer id="light" botId="bot" windowClosed={false} />);
    expect(
      screen.queryByRole('button', { name: 'channelInbox.sales.internalNote' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('channelInbox.sendHint')).not.toBeInTheDocument();
    expect(screen.queryByText('channelInbox.sales.draftInTab')).not.toBeInTheDocument();
  });

  it("offers Meta's thumbs-up only while the draft is empty, and it is a real send", async () => {
    const user = userEvent.setup();
    mocks.send.mockResolvedValue({ status: 'sent' });
    render(<MessageComposer id="like" botId="bot" windowClosed={false} />);
    await user.click(screen.getByRole('button', { name: 'channelInbox.meta.composer.like' }));
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: '👍', idempotencyKey: expect.any(String) }),
    );
    await user.type(screen.getByRole('textbox'), 'Draft');
    expect(
      screen.queryByRole('button', { name: 'channelInbox.meta.composer.like' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'channelInbox.send' })).toBeEnabled();
  });

  it('keeps the draft editable but sends nothing while the conversation is in Done or Spam', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="locked" botId="bot" windowClosed={false} locked />);
    expect(screen.getByRole('button', { name: 'channelInbox.meta.composer.like' })).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'Later{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('Later');
    expect(screen.getByRole('button', { name: 'channelInbox.send' })).toBeDisabled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('inserts an emoji at the caret without sending', async () => {
    const user = userEvent.setup();
    render(<MessageComposer id="emoji" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'channelInbox.meta.composer.emoji' }));
    await user.click(await screen.findByRole('button', { name: '😍' }));
    expect(screen.getByRole('textbox')).toHaveValue('Hi😍');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('names the channel in the placeholder', () => {
    render(
      <MessageComposer
        id="placeholder"
        botId="bot"
        windowClosed={false}
        channelLabel="Messenger"
      />,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'channelInbox.meta.composer.replyIn',
    );
  });

  it('explains a send refused because the conversation left the queue, and reloads it', async () => {
    const user = userEvent.setup();
    mocks.send.mockRejectedValue(new ApiClientError(409, 'CONFLICT', 'Reopen first'));
    render(<MessageComposer id="moved" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Hello{Enter}');
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('channelInbox.meta.composer.notSent'),
    );
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Hello');
  });

  it('says a refused send was a permission problem', async () => {
    const user = userEvent.setup();
    mocks.send.mockRejectedValue(new ApiClientError(403, 'FORBIDDEN', 'No access'));
    render(<MessageComposer id="forbidden" botId="bot" windowClosed={false} />);
    await user.type(screen.getByRole('textbox'), 'Hello{Enter}');
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('channelInbox.meta.locked.readOnly'),
    );
    expect(screen.getByRole('textbox')).toHaveValue('Hello');
  });
});
