import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { ContactDangerZone, ContactDeleteDialog } from './contact-delete';
import { ContactOverviewTab } from './contact-overview';
import type { CrmLookups } from '../hooks/use-crm-lookups';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
const perms = vi.hoisted(() => ({ caps: new Set<string>(['contacts.delete']) }));
vi.mock('@/lib/permissions', () => ({ useCan: (c: string) => perms.caps.has(c) }));
const me = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d40';
vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: me } }) }));

const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d31';
const contact = { id: CONTACT, name: 'Nguyễn Văn A', phone: '0912345678', email: null };

afterEach(() => {
  vi.unstubAllGlobals();
  perms.caps = new Set(['contacts.delete']);
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('ContactDeleteDialog', () => {
  it('says what is deleted and what stays anonymized, then deletes on confirm', async () => {
    const { fetchStub, calls } = stubFetch({
      [`DELETE /contacts/${CONTACT}`]: {
        status: 200,
        body: {
          contactId: CONTACT,
          conversations: 2,
          messages: 30,
          files: 1,
          orders: 3,
          bookings: 0,
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ContactDeleteDialog
        contact={contact}
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );

    expect(screen.getByText('Xoá vĩnh viễn Nguyễn Văn A?')).toBeVisible();
    expect(screen.getByText('Các hội thoại với khách và toàn bộ tin nhắn')).toBeVisible();
    expect(screen.getByText('Ảnh khách gửi qua chat website')).toBeVisible();
    expect(screen.getByText(/Hồ sơ, ghi chú/)).toBeVisible();
    expect(screen.getByText(/Đơn hàng và đặt phòng/)).toBeVisible();
    expect(calls).toHaveLength(0);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá vĩnh viễn' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(calls.map((c) => c.key)).toEqual([`DELETE /contacts/${CONTACT}`]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith(
      'Đã xoá khách hàng và 2 hội thoại; 3 đơn hàng, 0 đặt phòng được ẩn danh.',
    );
  });

  it('keeps the dialog and shows the error when the server refuses', async () => {
    const { fetchStub } = stubFetch({
      [`DELETE /contacts/${CONTACT}`]: {
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'no' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    renderWithProviders(
      <ContactDeleteDialog contact={contact} open onOpenChange={vi.fn()} onDeleted={onDeleted} />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá vĩnh viễn' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByText('Xoá vĩnh viễn Nguyễn Văn A?')).toBeVisible();
  });
});

describe('ContactDangerZone', () => {
  it('is hidden from members who may not delete customers', () => {
    perms.caps = new Set();
    renderWithProviders(<ContactDangerZone contact={contact} onDeleted={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Xoá khách hàng' })).toBeNull();
  });

  it('opens the confirmation from the button', async () => {
    renderWithProviders(<ContactDangerZone contact={contact} onDeleted={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Xoá khách hàng' }));
    expect(await screen.findByText('Xoá vĩnh viễn Nguyễn Văn A?')).toBeVisible();
  });
});

describe('note delete', () => {
  const note = (id: string, authorUserId: string | null) => ({
    id,
    body: `Ghi chú ${id.slice(-2)}`,
    authorUserId,
    authorName: 'Lan',
    createdAt: '2026-11-04T08:00:00.000Z',
    editedAt: null,
    version: 1,
  });
  const mine = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d51';
  const theirs = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d52';
  const routes = () =>
    stubFetch({
      [`GET /contacts/${CONTACT}/notes`]: {
        status: 200,
        body: { data: [note(mine, me), note(theirs, '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d99')] },
      },
      [`DELETE /contacts/${CONTACT}/notes/${mine}`]: { status: 204 },
    });
  const fullContact = { ...contact, statusId: null, version: 1 } as never;

  it('offers sales members a delete only on their own notes, and confirms first', async () => {
    perms.caps = new Set(['contacts.edit']);
    const { fetchStub, calls } = routes();
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <ContactOverviewTab
        contact={fullContact}
        lookups={{ statuses: [] } as unknown as CrmLookups}
      />,
    );
    const buttons = await screen.findAllByRole('button', { name: 'Xoá ghi chú' });
    expect(buttons).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(buttons[0] as HTMLElement);
    expect(await screen.findByText('Xoá ghi chú này?')).toBeVisible();
    const confirm = screen
      .getAllByRole('button', { name: 'Xoá ghi chú' })
      .find((b) => b.closest('[role="alertdialog"]'));
    await user.click(confirm as HTMLElement);
    await waitFor(() =>
      expect(calls.map((c) => c.key)).toContain(`DELETE /contacts/${CONTACT}/notes/${mine}`),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã xoá ghi chú'));
  });

  it('lets an owner delete any note', async () => {
    perms.caps = new Set(['contacts.edit', 'contacts.view_all']);
    const { fetchStub } = routes();
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <ContactOverviewTab
        contact={fullContact}
        lookups={{ statuses: [] } as unknown as CrmLookups}
      />,
    );
    expect(await screen.findAllByRole('button', { name: 'Xoá ghi chú' })).toHaveLength(2);
  });
});
