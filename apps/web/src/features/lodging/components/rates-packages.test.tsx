import type { PackageDto, PropertyDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
beforeAll(() => {
  // Radix Select uses pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const P6 = '0193a000-0000-7000-8000-000000000606';
const P5 = '0193a000-0000-7000-8000-000000000605';
const P4 = '0193a000-0000-7000-8000-000000000604';
const RP = '0193a000-0000-7000-8000-000000000611';

const pkg = (over: Partial<PackageDto>): PackageDto => ({
  id: P6,
  unitId: null,
  name: '6PN',
  bedrooms: 6,
  standardAdults: 12,
  standardChildren: 0,
  maxGuests: 14,
  sortOrder: 0,
  ...over,
});

const villa = propertyFixture({
  rates: [weekdayRate({ unitId: null, sell: 12_000_000, cost: 10_000_000 })],
  version: 3,
});

/** Aura-like villa: 6PN every day, 5PN every day, 4PN not sold on Friday–Sunday. */
const aura = propertyFixture({
  packages: [
    pkg({ id: P4, name: '4PN', bedrooms: 4, standardAdults: 8, maxGuests: 10, sortOrder: 0 }),
    pkg({ id: P5, name: '5PN', bedrooms: 5, standardAdults: 10, maxGuests: 12, sortOrder: 1 }),
    pkg({ id: P6, sortOrder: 2 }),
  ],
  rates: [
    weekdayRate({ id: `${P6.slice(0, -3)}701`, packageId: P6, sell: 20_000_000, cost: 18_000_000 }),
    weekdayRate({ id: `${P6.slice(0, -3)}702`, packageId: P5, sell: 16_000_000, cost: 14_000_000 }),
    weekdayRate({
      id: `${P6.slice(0, -3)}703`,
      packageId: P4,
      weekdays: [1, 2, 3, 4],
      sell: 8_000_000,
      cost: 7_000_000,
    }),
  ],
  version: 5,
});

function stub(p: PropertyDto) {
  const { fetchStub, calls } = stubLodgingApi({
    [`PUT /lodging/properties/${p.id}/rates`]: { status: 200, body: p },
    [`PATCH /lodging/properties/${p.id}`]: { status: 200, body: p },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

const putBody = (calls: Array<{ key: string; body: unknown }>) =>
  calls.find((c) => c.key.startsWith('PUT'))?.body as
    | {
        weekday: Array<{ unitId: string | null; weekdays: number[]; packageKey?: string }>;
        packages?: Array<Record<string, unknown>>;
      }
    | undefined;

async function fillPackage(i: number, name: string, bedrooms: string, adults: string) {
  for (const [label, value] of [
    ['Tên gói', name],
    ['Phòng ngủ', bedrooms],
    ['NL tiêu chuẩn', adults],
  ] as const) {
    await userEvent.click(screen.getAllByLabelText(label)[i]!);
    await userEvent.paste(value);
  }
}

/** Click a field and paste the value (much faster than typing it key by key). */
async function paste(label: string, value: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.paste(value);
}

const rowHeaders = () =>
  screen
    .getAllByRole('rowheader')
    .map((h) => h.textContent)
    .filter(Boolean);

describe('RatesTab bedroom packages', () => {
  it(
    'adds three packages, shows a row pair each (most bedrooms first) and saves them',
    {
      timeout: 20_000,
    },
    async () => {
      const calls = stub(villa);
      renderWithRouter(() => <RatesTab property={villa} canEdit onDirtyChange={() => {}} />);
      await screen.findByText('Gói phòng');
      const add = screen.getByRole('button', { name: 'Thêm gói' });
      await userEvent.click(add);
      await fillPackage(0, '6PN', '6', '12');
      await userEvent.click(add);
      await fillPackage(1, '4PN', '4', '8');
      await userEvent.click(add);
      await fillPackage(2, '5PN', '5', '10');

      expect(rowHeaders()).toEqual(['6PNGói đầy đủ', '5PN', '4PN']);
      // The first package took over the plain prices.
      expect(screen.getByLabelText('Giá bán Nguyên căn · 6PN T2')).toHaveValue('12.000.000');
      for (const day of ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']) {
        await paste(`Giá bán Nguyên căn · 5PN ${day}`, '9000000');
        await paste(`Giá bán Nguyên căn · 4PN ${day}`, '7000000');
      }
      await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));

      await waitFor(() => expect(putBody(calls)).toBeDefined());
      const body = putBody(calls)!;
      expect(body.packages).toEqual([
        expect.objectContaining({ unitId: null, name: '6PN', bedrooms: 6, standardAdults: 12 }),
        expect.objectContaining({ unitId: null, name: '4PN', bedrooms: 4, standardAdults: 8 }),
        expect.objectContaining({ unitId: null, name: '5PN', bedrooms: 5, standardAdults: 10 }),
      ]);
      expect(body.packages!.every((k) => !('id' in k) && typeof k.key === 'string')).toBe(true);
      const keyOf = (name: string) => body.packages!.find((k) => k.name === name)!.key;
      expect(body.weekday).toEqual([
        expect.objectContaining({ packageKey: keyOf('6PN'), sell: 12_000_000, cost: 10_000_000 }),
        expect.objectContaining({ packageKey: keyOf('5PN'), sell: 9_000_000 }),
        expect.objectContaining({ packageKey: keyOf('4PN'), sell: 7_000_000 }),
      ]);
      expect(body.weekday.every((r) => r.weekdays.length === 7 && r.unitId === null)).toBe(true);
    },
  );

  it('shows "Không bán" on an empty day of a smaller package and saves no rate for it', async () => {
    const calls = stub(aura);
    renderWithRouter(() => <RatesTab property={aura} canEdit onDirtyChange={() => {}} />);
    const fri = await screen.findByLabelText('Giá bán Nguyên căn · 4PN T6');
    expect(fri).toHaveValue('');
    expect(fri).toHaveAttribute('placeholder', 'Không bán');
    expect(screen.getByLabelText('Giá bán Nguyên căn · 6PN T6')).toHaveAttribute(
      'placeholder',
      'Giá bán',
    );
    // Sell 4PN on Saturday only: Friday and Sunday stay "not sold".
    await userEvent.type(screen.getByLabelText('Giá bán Nguyên căn · 4PN T7'), '9500000');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    await waitFor(() => expect(putBody(calls)).toBeDefined());
    const body = putBody(calls)!;
    expect(body.weekday.filter((r) => r.packageKey === P4)).toEqual([
      { unitId: null, packageKey: P4, weekdays: [1, 2, 3, 4], sell: 8_000_000, cost: 7_000_000 },
      { unitId: null, packageKey: P4, weekdays: [6], sell: 9_500_000, cost: 9_500_000 },
    ]);
    // Every loaded package is sent back with its id (key = id).
    expect(body.packages?.map((k) => [k.id, k.key])).toEqual([
      [P4, P4],
      [P5, P5],
      [P6, P6],
    ]);
  });

  it('blocks saving while the full package misses a day', async () => {
    const calls = stub(aura);
    renderWithRouter(() => <RatesTab property={aura} canEdit onDirtyChange={() => {}} />);
    await userEvent.clear(await screen.findByLabelText('Giá bán Nguyên căn · 6PN CN'));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    expect(await screen.findByText('Nguyên căn · 6PN: thiếu giá bán CN')).toBeInTheDocument();
    expect(screen.getByLabelText('Giá bán Nguyên căn · 6PN CN')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });

  it('refuses duplicate bedrooms and an empty package name', async () => {
    const calls = stub(aura);
    renderWithRouter(() => <RatesTab property={aura} canEdit onDirtyChange={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm gói' }));
    await userEvent.type(screen.getAllByLabelText('Phòng ngủ')[3]!, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    expect(
      await screen.findByText(
        /Nhập tên gói\. Hai gói không được cùng số phòng ngủ\./,
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('PUT'))).toBe(false);
  });

  it('removing the last package gives its prices back to the place', async () => {
    const one = propertyFixture({
      packages: [pkg({})],
      rates: [weekdayRate({ packageId: P6, sell: 20_000_000, cost: 18_000_000 })],
    });
    const calls = stub(one);
    renderWithRouter(() => <RatesTab property={one} canEdit onDirtyChange={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Xoá gói 6PN' }));
    expect(screen.getByLabelText('Giá bán Nguyên căn T2')).toHaveValue('20.000.000');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    await waitFor(() =>
      expect(putBody(calls)).toEqual({
        version: 1,
        weekday: [
          { unitId: null, weekdays: [1, 2, 3, 4, 5, 6, 7], sell: 20_000_000, cost: 18_000_000 },
        ],
        surcharges: { extraAdult: null, extraChild: null },
      }),
    );
  });
});

describe('RatesTab target filter', () => {
  const rooms = propertyFixture({
    id: LODGING_IDS.h1,
    sellMode: 'rooms',
    units: [
      unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'B1', capacityAdults: 4 }),
      unitFixture({ id: LODGING_IDS.r2, kind: 'room', name: 'B2', capacityAdults: 2 }),
    ],
    packages: [pkg({ id: RP, unitId: LODGING_IDS.r1, name: '2PN', bedrooms: 2 })],
    rates: [
      weekdayRate({ unitId: LODGING_IDS.r1, packageId: RP, sell: 3_000_000, cost: 2_500_000 }),
      weekdayRate({ id: `${RP.slice(0, -3)}801`, unitId: LODGING_IDS.r2, sell: 1_000_000 }),
    ],
    version: 2,
  });

  it("shows one unit's packages and rows only, and saves every target", async () => {
    const calls = stub(rooms);
    renderWithRouter(() => (
      <RatesTab property={rooms} canEdit target={LODGING_IDS.r2} onDirtyChange={() => {}} />
    ));
    await screen.findByText('Gói phòng');
    expect(rowHeaders()).toEqual(['B2']);
    expect(screen.queryByText('Phụ thu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Thêm gói' }));
    await fillPackage(0, '1PN', '1', '2');
    expect(rowHeaders()).toEqual(['1PNGói đầy đủ']);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    await waitFor(() => expect(putBody(calls)).toBeDefined());
    const body = putBody(calls)!;
    const newKey = body.packages!.find((k) => k.name === '1PN')!.key;
    expect(body.packages).toEqual([
      expect.objectContaining({ id: RP, key: RP, unitId: LODGING_IDS.r1, name: '2PN' }),
      expect.objectContaining({ key: newKey, unitId: LODGING_IDS.r2, name: '1PN', bedrooms: 1 }),
    ]);
    expect(body.weekday).toEqual([
      expect.objectContaining({ unitId: LODGING_IDS.r1, packageKey: RP, sell: 3_000_000 }),
      expect.objectContaining({ unitId: LODGING_IDS.r2, packageKey: newKey, sell: 1_000_000 }),
    ]);
  });

  it('sends back the packages of an inactive room that has no prices', async () => {
    const off = {
      ...rooms,
      units: rooms.units.map((u) => (u.id === LODGING_IDS.r1 ? { ...u, active: false } : u)),
      rates: rooms.rates.filter((r) => r.unitId === LODGING_IDS.r2),
    };
    const calls = stub(off);
    renderWithRouter(() => <RatesTab property={off} canEdit onDirtyChange={() => {}} />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('2PN')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lưu giá' }));
    await waitFor(() => expect(putBody(calls)).toBeDefined());
    const body = putBody(calls)!;
    expect(body.packages).toEqual([expect.objectContaining({ id: RP, unitId: LODGING_IDS.r1 })]);
    expect(body.weekday.map((r) => r.unitId)).toEqual([LODGING_IDS.r2]);
  });
});

describe('OverrideDialog with packages', () => {
  it('asks for the package (full one preselected) and sends its id', async () => {
    const { fetchStub, calls } = stubLodgingApi({
      [`POST /lodging/properties/${aura.id}/overrides`]: { status: 200, body: aura },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderWithRouter(() => <RatesTab property={aura} canEdit onDirtyChange={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Thêm ngày đặc biệt' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByRole('combobox', { name: 'Gói' });
    expect(select).toHaveTextContent('6PN');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: '4PN' }));
    await user.type(within(dialog).getByLabelText('Tên'), 'Tết');
    await user.type(within(dialog).getByLabelText('Từ đêm'), '2027-02-05');
    await user.type(within(dialog).getByLabelText('Đến đêm (gồm cả đêm này)'), '2027-02-07');
    await user.type(within(dialog).getByLabelText('Giá bán'), '15000000');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.startsWith('POST'))?.body).toMatchObject({
        unitId: null,
        packageId: P4,
        sell: 15_000_000,
      }),
    );
  });
});
