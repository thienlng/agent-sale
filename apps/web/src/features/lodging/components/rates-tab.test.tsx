import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LODGING_IDS,
  propertyFixture,
  stubLodgingApi,
  unitFixture,
  weekdayRate,
} from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { RatesTab } from './rates-tab';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rooms = propertyFixture({
  id: LODGING_IDS.h1,
  code: 'H1',
  sellMode: 'rooms',
  units: [
    unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'P101', capacityAdults: 2 }),
    unitFixture({ id: LODGING_IDS.r2, kind: 'room', name: 'P102', capacityAdults: 2 }),
  ],
  rates: [
    weekdayRate({
      unitId: LODGING_IDS.r1,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      sell: 600_000,
      cost: 500_000,
    }),
  ],
  version: 4,
});

function stub() {
  const { fetchStub, calls } = stubLodgingApi({
    [`PUT /lodging/properties/${LODGING_IDS.h1}/rates`]: { status: 200, body: rooms },
    [`PATCH /lodging/properties/${LODGING_IDS.h1}`]: { status: 200, body: rooms },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

describe('RatesTab', () => {
  it('blocks saving while a weekday price is empty and points at the row', async () => {
    const calls = stub();
    renderWithRouter(() => <RatesTab property={rooms} canEdit onDirtyChange={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu giá' }));
    const error = await screen.findByText('P102: thiếu giá bán T2, T3, T4, T5, T6, T7, CN');
    expect(error).toBeInTheDocument();
    expect(screen.getByLabelText('Giá bán P102 T2')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });

  it('saves runs of equal days as one rule', async () => {
    const calls = stub();
    renderWithRouter(() => <RatesTab property={rooms} canEdit onDirtyChange={() => {}} />);
    await screen.findByLabelText('Giá bán P102 T2');
    for (const day of ['T2', 'T3', 'T4', 'T5'])
      await userEvent.type(screen.getByLabelText(`Giá bán P102 ${day}`), '700000');
    for (const day of ['T6', 'T7', 'CN'])
      await userEvent.type(screen.getByLabelText(`Giá bán P102 ${day}`), '900000');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('PUT'))?.body).toEqual({
        version: 4,
        weekday: [
          { unitId: LODGING_IDS.r1, weekdays: [1, 2, 3, 4, 5, 6, 7], sell: 600_000, cost: 500_000 },
          { unitId: LODGING_IDS.r2, weekdays: [1, 2, 3, 4], sell: 700_000, cost: 700_000 },
          { unitId: LODGING_IDS.r2, weekdays: [5, 6, 7], sell: 900_000, cost: 900_000 },
        ],
        surcharges: { extraAdult: null, extraChild: null },
      }),
    );
    expect(within(document.body).queryByText(/thiếu giá bán/)).toBeNull();
  });

  it('refuses to save a rooms place with every room off and no whole price', async () => {
    const calls = stub();
    const allOff = {
      ...rooms,
      units: rooms.units.map((u) => ({ ...u, active: false })),
      rates: [],
    };
    renderWithRouter(() => <RatesTab property={allOff} canEdit onDirtyChange={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu giá' }));
    expect(
      await screen.findByText(
        'Chưa có giá nào để lưu. Bật ít nhất một phòng hoặc nhập giá nguyên căn.',
      ),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });

  it('captions both surcharge boxes as sell and cost (VL-A6)', async () => {
    stub();
    renderWithRouter(() => <RatesTab property={rooms} canEdit onDirtyChange={() => {}} />);
    const group = await screen.findByRole('group', { name: 'Phụ thu người lớn' });
    expect(within(group).getByText('Giá bán')).toBeVisible();
    expect(within(group).getByText('Giá nhập')).toBeVisible();
    expect(within(group).getByLabelText('Phụ thu người lớn · Giá nhập')).toBeInTheDocument();
  });
});
