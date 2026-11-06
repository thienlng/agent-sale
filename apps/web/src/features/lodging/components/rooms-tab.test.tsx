import type { PropertyDto } from '@agent-sales/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
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
import { renderWithProviders } from '@/testing/render';

import { RoomsTab } from './rooms-tab';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const NEW_ID = '0193a000-0000-7000-8000-000000000023';
const photo = { kind: 'image' as const, url: 'https://cdn.example.com/b1.jpg', caption: '' };
const PKG_FULL = '0193a000-0000-7000-8000-000000000701';
const resort = propertyFixture({
  id: LODGING_IDS.h1,
  code: 'TR1',
  sellMode: 'rooms',
  units: [
    unitFixture({
      id: LODGING_IDS.r1,
      kind: 'room',
      name: 'Nhà chính',
      category: 'house',
      view: 'View hồ',
      capacityAdults: 8,
      capacityChildren: 2,
      maxGuests: 14,
      gallery: [{ id: 'f1', name: 'Phòng khách', items: [photo] }],
    }),
    unitFixture({
      id: LODGING_IDS.r2,
      kind: 'room',
      name: 'Bungalow 1',
      category: 'bungalow',
      capacityAdults: 2,
      capacityChildren: 0,
      sortOrder: 1,
    }),
  ],
  packages: [
    {
      id: PKG_FULL,
      unitId: LODGING_IDS.r1,
      name: '4PN',
      bedrooms: 4,
      standardAdults: 8,
      standardChildren: 0,
      maxGuests: 14,
      sortOrder: 0,
    },
  ],
  rates: [
    weekdayRate({
      unitId: LODGING_IDS.r1,
      packageId: PKG_FULL,
      weekdays: [1, 2, 3, 4, 7],
      sell: 6_000_000,
    }),
    weekdayRate({ unitId: LODGING_IDS.r1, packageId: PKG_FULL, weekdays: [5, 6], sell: 8_000_000 }),
  ],
});

function renderTab(property: PropertyDto) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <RoomsTab property={property} canEdit />,
  });
  const unit = createRoute({
    getParentRoute: () => root,
    path: '/app/properties/$propertyId/units/$unitId',
    component: function Unit() {
      const { unitId } = unit.useParams();
      return <p>unit page {unitId}</p>;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([page, unit]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  renderWithProviders(<RouterProvider router={router} />);
}

describe('RoomsTab unit cards', () => {
  it('shows one card per unit with its type, view, party, lowest full-package price and link', async () => {
    vi.stubGlobal('fetch', stubLodgingApi({}).fetchStub);
    renderTab(resort);
    const house = await screen.findByRole('article', { name: 'Nhà chính' });
    expect(within(house).getByText('Nhà')).toBeInTheDocument();
    expect(within(house).getByText('View hồ')).toBeInTheDocument();
    expect(within(house).getByText('Tiêu chuẩn 10 · Tối đa 14')).toBeInTheDocument();
    expect(within(house).getByText(/^từ 6\.000\.000/)).toBeInTheDocument();
    expect(within(house).getByRole('img', { name: 'Nhà chính' })).toHaveAttribute('src', photo.url);
    expect(within(house).getByRole('link', { name: 'Nhà chính' })).toHaveAttribute(
      'href',
      `/app/properties/${LODGING_IDS.h1}/units/${LODGING_IDS.r1}`,
    );
    const bungalow = screen.getByRole('article', { name: 'Bungalow 1' });
    expect(within(bungalow).getByText('Tiêu chuẩn 2')).toBeInTheDocument();
    expect(within(bungalow).getByText('Chưa có giá')).toBeInTheDocument();
    expect(within(bungalow).getByText('Chưa có ảnh')).toBeInTheDocument();
  });

  it('turns a unit off by sending every unit back with all of its fields', async () => {
    const { fetchStub, calls } = stubLodgingApi({
      [`PUT /lodging/properties/${LODGING_IDS.h1}/units`]: { status: 200, body: resort },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderTab(resort);
    await userEvent.click(await screen.findByRole('switch', { name: 'Bán Bungalow 1' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const body = calls[0]?.body as { version: number; units: Array<Record<string, unknown>> };
    expect(body.version).toBe(resort.version);
    expect(body.units).toHaveLength(2);
    expect(body.units[0]).toMatchObject({
      id: LODGING_IDS.r1,
      category: 'house',
      view: 'View hồ',
      maxGuests: 14,
      gallery: [{ id: 'f1', name: 'Phòng khách', items: [photo] }],
      active: true,
    });
    expect(body.units[1]).toMatchObject({ id: LODGING_IDS.r2, active: false });
  });

  it('moves a unit later and deletes one after confirming', async () => {
    const { fetchStub, calls } = stubLodgingApi({
      [`PUT /lodging/properties/${LODGING_IDS.h1}/units`]: { status: 200, body: resort },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderTab(resort);
    await user.click(await screen.findByRole('button', { name: 'Tuỳ chọn cho Nhà chính' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Đưa ra sau' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0]?.body as { units: Array<{ id: string }> }).units.map((u) => u.id)).toEqual([
      LODGING_IDS.r2,
      LODGING_IDS.r1,
    ]);

    await user.click(screen.getByRole('button', { name: 'Tuỳ chọn cho Bungalow 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xoá đơn vị' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect((calls[1]?.body as { units: Array<{ id: string }> }).units.map((u) => u.id)).toEqual([
      LODGING_IDS.r1,
    ]);
  });

  it('adds a unit with its name and type, then opens its page', async () => {
    const saved = {
      ...resort,
      units: [
        ...resort.units,
        unitFixture({
          id: NEW_ID,
          kind: 'room',
          name: 'Bungalow 2',
          category: 'bungalow',
          sortOrder: 2,
        }),
      ],
    };
    const { fetchStub, calls } = stubLodgingApi({
      [`PUT /lodging/properties/${LODGING_IDS.h1}/units`]: { status: 200, body: saved },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderTab(resort);
    await user.click(await screen.findByRole('button', { name: 'Thêm đơn vị' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm và mở' }));
    expect(within(dialog).getByText('Nhập tên đơn vị.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await user.type(within(dialog).getByLabelText('Tên'), 'Bungalow 2');
    await user.click(within(dialog).getByRole('combobox', { name: 'Loại' }));
    await user.click(await screen.findByRole('option', { name: 'Bungalow' }));
    await user.click(within(dialog).getByRole('button', { name: 'Thêm và mở' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const units = (calls[0]?.body as { units: Array<Record<string, unknown>> }).units;
    expect(units).toHaveLength(3);
    expect(units[2]).toEqual({
      name: 'Bungalow 2',
      category: 'bungalow',
      capacityAdults: 2,
      capacityChildren: 0,
      active: true,
    });
    expect(await screen.findByText(`unit page ${NEW_ID}`)).toBeInTheDocument();
  });
});
