import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  LODGING_IDS,
  propertyFixture,
  stubLodgingApi,
  unitFixture,
  weekdayRate,
} from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { UnitPage } from './unit-page';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
// Long user-event flows: the default 5 s is too short while the whole gate runs in parallel.
vi.setConfig({ testTimeout: 20_000 });
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(() => vi.unstubAllGlobals());

const photo = { kind: 'image' as const, url: 'https://cdn.example.com/house.jpg', caption: '' };
const house = unitFixture({
  id: LODGING_IDS.r1,
  kind: 'room',
  name: 'Nhà chính',
  category: 'house',
  capacityAdults: 8,
  capacityChildren: 0,
  gallery: [{ id: 'f1', name: 'Phòng khách', items: [photo] }],
});
const bungalow = unitFixture({
  id: LODGING_IDS.r2,
  kind: 'room',
  name: 'Bungalow 1',
  category: 'bungalow',
  view: 'View đồi thông',
  capacityAdults: 2,
  capacityChildren: 0,
  sortOrder: 1,
});
const resort = propertyFixture({
  id: LODGING_IDS.h1,
  code: 'TR1',
  name: 'Resort test',
  sellMode: 'rooms',
  units: [house, bungalow],
  rates: [
    weekdayRate({
      id: '0193a000-0000-7000-8000-000000000511',
      unitId: LODGING_IDS.r1,
      sell: 6_000_000,
    }),
    weekdayRate({
      id: '0193a000-0000-7000-8000-000000000512',
      unitId: LODGING_IDS.r2,
      sell: 1_500_000,
    }),
  ],
});
const path = `/lodging/properties/${LODGING_IDS.h1}`;

function renderPage(unitId: string = LODGING_IDS.r2) {
  function Harness() {
    const [folder, setFolder] = useState<string | undefined>();
    return (
      <UnitPage
        propertyId={LODGING_IDS.h1}
        unitId={unitId}
        folderId={folder}
        onFolderChange={setFolder}
      />
    );
  }
  renderWithRouter(() => <Harness />);
}

describe('UnitPage', () => {
  it('saves the unit details with every other unit sent back unchanged', async () => {
    const { fetchStub, calls } = stubLodgingApi({
      [`GET ${path}`]: { status: 200, body: resort },
      [`PUT ${path}/units`]: { status: 200, body: resort },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Bungalow 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /TR1 · Đơn vị cho thuê/ })).toHaveAttribute(
      'href',
      `/app/properties/${LODGING_IDS.h1}?tab=rooms`,
    );
    const view = screen.getByLabelText('View');
    await user.clear(view);
    await user.type(view, 'View suối');
    await user.type(screen.getByLabelText('Diện tích (m²)'), '35');
    await user.type(screen.getByLabelText('Tối đa khách'), '3');
    await user.type(screen.getByLabelText('Mô tả'), 'Bungalow gỗ cạnh suối');
    await user.type(screen.getByLabelText('Tiện ích riêng'), 'Bồn tắm{Enter}Ban công');
    expect(screen.getByRole('tab', { name: /Thông tin.*Chưa lưu/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu thông tin' }));

    await waitFor(() => expect(calls.filter((c) => c.key.startsWith('PUT'))).toHaveLength(1));
    const body = calls.find((c) => c.key.startsWith('PUT'))?.body as {
      units: Array<Record<string, unknown>>;
    };
    expect(body.units[0]).toMatchObject({
      id: LODGING_IDS.r1,
      gallery: house.gallery,
      category: 'house',
    });
    expect(body.units[1]).toMatchObject({
      id: LODGING_IDS.r2,
      name: 'Bungalow 1',
      category: 'bungalow',
      view: 'View suối',
      areaM2: 35,
      maxGuests: 3,
      description: 'Bungalow gỗ cạnh suối',
      amenities: ['Bồn tắm', 'Ban công'],
      capacityAdults: 2,
      active: true,
    });
  });

  it('edits the unit gallery with the folder UI and saves it on that unit only', async () => {
    const { fetchStub, calls } = stubLodgingApi({
      [`GET ${path}`]: { status: 200, body: resort },
      [`PUT ${path}/units`]: { status: 200, body: resort },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    renderPage(LODGING_IDS.r1);
    await user.click(await screen.findByRole('tab', { name: 'Ảnh & video' }));
    await user.click(screen.getByRole('button', { name: 'Thư mục mới' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tên thư mục'), 'Phòng ngủ');
    await user.click(within(dialog).getByRole('button', { name: 'Tạo thư mục' }));
    await user.click(screen.getByRole('button', { name: 'Lưu ảnh & video' }));

    await waitFor(() => expect(calls.filter((c) => c.key.startsWith('PUT'))).toHaveLength(1));
    const body = calls.find((c) => c.key.startsWith('PUT'))?.body as {
      units: Array<Record<string, unknown>>;
    };
    expect(body.units[0]).toMatchObject({
      id: LODGING_IDS.r1,
      gallery: [
        { id: 'f1', name: 'Phòng khách', items: [photo] },
        { id: expect.any(String), name: 'Phòng ngủ', items: [] },
      ],
      galleryCover: '',
    });
    expect(body.units[1]).toMatchObject({ id: LODGING_IDS.r2, gallery: [] });
  });

  it('shows only this unit in the Giá tab', async () => {
    vi.stubGlobal(
      'fetch',
      stubLodgingApi({ [`GET ${path}`]: { status: 200, body: resort } }).fetchStub,
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Giá' }));
    const panel = screen.getByRole('tabpanel', { name: 'Giá' });
    expect(within(panel).getAllByLabelText(/^Giá bán Bungalow 1/).length).toBeGreaterThan(0);
    expect(within(panel).queryAllByLabelText(/^Giá bán Nhà chính/)).toHaveLength(0);
    expect(within(panel).getByRole('heading', { name: 'Gói phòng' })).toBeInTheDocument();
  });

  it('says the unit is not found and links back to the units', async () => {
    vi.stubGlobal(
      'fetch',
      stubLodgingApi({ [`GET ${path}`]: { status: 200, body: resort } }).fetchStub,
    );
    renderPage('0193a000-0000-7000-8000-000000000099');
    expect(await screen.findByText('Không tìm thấy đơn vị này.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đơn vị cho thuê' })).toBeInTheDocument();
  });
});
