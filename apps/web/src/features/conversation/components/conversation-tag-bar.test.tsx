import type { TagDto } from '@agent-sales/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, renderWithRouter } from '@/testing/render';
import { ConversationTagBar } from './conversation-tag-bar';

const mocks = vi.hoisted(() => ({ attach: vi.fn(), remove: vi.fn(), fail: false }));
const base = {
  color: '#16a34a',
  type: 'attribute',
  description: '',
  schemaVersion: 1,
  isSystem: false,
  archived: false,
  createdByName: null,
  activeCount: 0,
  version: 1,
  updatedAt: '2026-10-26T00:00:00.000Z',
} as const;
const tags: TagDto[] = [
  {
    ...base,
    id: 'event',
    name: 'Event',
    fields: [
      {
        key: 'event_name',
        label: 'Event name',
        type: 'text',
        required: true,
        options: [],
        archived: false,
      },
      {
        key: 'guests',
        label: 'Guests',
        type: 'number',
        required: true,
        options: [],
        archived: false,
      },
      {
        key: 'confirmed',
        label: 'Confirmed',
        type: 'boolean',
        required: true,
        options: [],
        archived: false,
      },
      { key: 'old', label: 'Archived', type: 'text', required: true, options: [], archived: true },
    ],
  },
  { ...base, id: 'vip', name: 'VIP', fields: [] },
];
vi.mock('../api/inbox', () => ({
  useInboxTags: () => ({ data: tags }),
  useConversationTags: () => ({ data: [] }),
  useConversationTagActions: () => ({
    attach: { mutate: mocks.attach, isPending: false },
    remove: { mutate: mocks.remove, isPending: false },
  }),
}));
beforeEach(() => {
  mocks.attach.mockReset();
  mocks.attach.mockImplementation((_tag, handlers) => {
    if (mocks.fail) handlers?.onError(new Error('offline'));
    else handlers?.onSuccess();
  });
  mocks.fail = false;
});
const props = {
  id: 'c1',
  fallbackTags: [],
  expanded: true,
  onExpandedChange: vi.fn(),
  pickerOpen: false,
  onPickerOpenChange: vi.fn(),
  readOnly: false,
};

describe('conversation attribute tags', () => {
  it('asks for required values and sends zero and false without dropping them', async () => {
    renderWithRouter(() => <ConversationTagBar {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gắn tag Event' }));
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Archived/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Event name *'), 'Opening');
    await user.type(screen.getByLabelText('Guests *'), '0');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(mocks.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'event',
        values: { event_name: 'Opening', guests: 0, confirmed: false },
      }),
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('cancels without sending an assignment', async () => {
    renderWithRouter(() => <ConversationTagBar {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gắn tag Event' }));
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it('keeps values available to retry after a failed save', async () => {
    mocks.fail = true;
    renderWithRouter(() => <ConversationTagBar {...props} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gắn tag Event' }));
    await user.type(screen.getByLabelText('Event name *'), 'Opening');
    await user.type(screen.getByLabelText('Guests *'), '0');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.getByLabelText('Event name *')).toHaveValue('Opening');
    expect(screen.getByRole('alert')).toHaveTextContent('Không cập nhật được tag');
    mocks.fail = false;
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('retains one-click assignment for tags with no active fields', async () => {
    renderWithRouter(() => <ConversationTagBar {...props} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Gắn tag VIP' }));
    expect(mocks.attach).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'vip' }),
      expect.anything(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

it('discards an unfinished attribute form when the conversation changes', async () => {
  const { rerender } = renderWithProviders(<ConversationTagBar {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Gắn tag Event' }));
  await user.type(screen.getByLabelText('Event name *'), 'Previous customer');
  rerender(<ConversationTagBar {...props} id="c2" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Gắn tag Event' }));
  expect(screen.getByLabelText('Event name *')).toHaveValue('');
  expect(mocks.attach).not.toHaveBeenCalled();
});
