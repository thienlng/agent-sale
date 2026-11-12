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
      message: 'A property with bookings cannot be deleted',
      details: { reason: 'property_has_bookings' },
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

  it('keeps a property with bookings and pauses it in one click instead', async () => {
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

    expect(await within(dialog).findByText(/đã có booking nên không xoá được/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Xoá vĩnh viễn' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tạm dừng căn hộ' }));
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
    expect(await within(dialog).findByText(/Căn hộ đang tạm dừng/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Tạm dừng căn hộ' })).toBeNull();
  });
});
