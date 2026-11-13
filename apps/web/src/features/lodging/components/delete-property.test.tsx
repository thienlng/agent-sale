import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LODGING_IDS, propertyFixture, stubLodgingApi } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { DeletePropertySection } from './delete-property';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockReset();
  toast.error.mockReset();
});

const path = `/lodging/properties/${LODGING_IDS.a17}`;
const hasBookings = {
  status: 409,
  body: {
    error: {
      code: 'CONFLICT',
      message: 'The property has bookings; confirm deleting them too',
      details: { reason: 'property_has_bookings', bookings: 3, upcoming: 1 },
    },
  },
};

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Xoá căn hộ' }));
  return screen.findByRole('alertdialog', { name: 'Xoá căn hộ A17 · Villa A17 Vinpearl?' });
}

describe('DeletePropertySection', () => {
  it('names the property, says it cannot be undone, deletes it and leaves the editor', async () => {
    const { fetchStub, calls } = stubLodgingApi({ [`DELETE ${path}`]: { status: 204 } });
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    renderWithRouter(() => (
      <DeletePropertySection property={propertyFixture()} onDeleted={onDeleted} />
    ));
    const dialog = await openDialog();
    expect(within(dialog).getByText(/Không thể hoàn tác/)).toBeInTheDocument();
    expect(calls).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(calls.map((c) => c.key)).toEqual([`DELETE ${path}`]);
    expect(toast.success).toHaveBeenCalledWith('Đã xoá căn hộ A17 · Villa A17 Vinpearl.');
  });

  it('deletes a property with bookings once the owner types (or copies) its code', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = {
      [`DELETE ${path}`]: hasBookings,
    };
    const { fetchStub, calls } = stubLodgingApi(routes);
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    renderWithRouter(() => (
      <DeletePropertySection property={propertyFixture()} onDeleted={onDeleted} />
    ));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Xoá căn hộ' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Xoá căn hộ A17 · Villa A17 Vinpearl?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));

    expect(await within(dialog).findByText(/Căn hộ này có 3 booking/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 booking còn hiệu lực/)).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Xoá căn hộ và 3 booking' });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Chép mã A17' }));
    expect(await navigator.clipboard.readText()).toBe('A17');
    await user.click(within(dialog).getByLabelText('Nhập mã căn hộ để xác nhận'));
    await user.paste('A17');
    routes[`DELETE ${path}`] = { status: 204 };
    await user.click(submit);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(calls.map((c) => c.url)).toEqual([path, `${path}?withBookings=true`]);
  });

  it('offers to pause a property with bookings instead of deleting it', async () => {
    const { fetchStub, calls } = stubLodgingApi({
      [`DELETE ${path}`]: hasBookings,
      [`PATCH ${path}`]: { status: 200, body: propertyFixture({ status: 'paused', version: 2 }) },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    renderWithRouter(() => (
      <DeletePropertySection property={propertyFixture()} onDeleted={onDeleted} />
    ));
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Tạm dừng căn hộ' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH ${path}`)?.body).toEqual({
        version: 1,
        patch: { status: 'paused' },
      }),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('offers no pause for a property that is already paused', async () => {
    const { fetchStub } = stubLodgingApi({ [`DELETE ${path}`]: hasBookings });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => (
      <DeletePropertySection property={propertyFixture({ status: 'paused' })} onDeleted={vi.fn()} />
    ));
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));
    expect(await within(dialog).findByText(/Căn hộ này có 3 booking/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Tạm dừng căn hộ' })).toBeNull();
  });
});
