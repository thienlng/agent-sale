import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LODGING_IDS,
  propertyFixture,
  stubLodgingApi,
  summaryFixture,
  unitFixture,
} from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { PropertiesPage } from './properties-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const a17 = summaryFixture({
  today: 'occupied',
  address: 'Lô D33 Sân Golf Tam Đảo, Phú Thọ',
  weekdaySell: [13_200_000, 13_200_000, 13_200_000, 13_200_000, 15_400_000, 17_600_000, 15_400_000],
});
const h1 = summaryFixture({
  id: LODGING_IDS.h1,
  code: 'H1',
  name: 'Homestay Hoa Sứ',
  sellMode: 'rooms',
  standardAdults: 4,
  standardChildren: 2,
  units: [
    unitFixture({ id: LODGING_IDS.r1, kind: 'room', name: 'P101', active: false }),
    unitFixture({ id: LODGING_IDS.r2, kind: 'room', name: 'P102', active: false }),
  ],
});

function stub() {
  const { fetchStub, calls } = stubLodgingApi({
    'GET /lodging/properties': { status: 200, body: { data: [a17, h1] } },
    'GET /lodging/calendar': {
      status: 200,
      body: { from: '2026-11-01', to: '2026-11-08', today: '2026-11-01', properties: [] },
    },
    'POST /lodging/properties': {
      status: 201,
      body: propertyFixture({ id: LODGING_IDS.h1, code: 'B2', name: 'Villa B2' }),
    },
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

describe('PropertiesPage', () => {
  it('shows each place with its sell mode, capacity and today state', async () => {
    stub();
    renderWithRouter(() => <PropertiesPage />);
    const a17Card = await screen.findByRole('article', { name: /A17/ });
    expect(within(a17Card).getByText('Nguyên căn')).toBeInTheDocument();
    expect(within(a17Card).getByText('24 NL + 8 TE')).toBeInTheDocument();
    expect(within(a17Card).getByText('Đang có khách')).toBeInTheDocument();
    const h1Card = screen.getByRole('article', { name: /H1/ });
    expect(within(h1Card).getByText('Theo phòng')).toBeInTheDocument();
    expect(within(h1Card).getByText(/Bot chưa chào bán/)).toBeInTheDocument();
    expect(within(a17Card).queryByText(/Bot chưa chào bán/)).toBeNull();
    expect(document.body).not.toHaveTextContent(/sản phẩm/i);
  });

  it('crops every cover to one fixed ratio so the cards line up', async () => {
    const tall = summaryFixture({
      id: LODGING_IDS.h1,
      code: 'T1',
      gallery: [
        {
          id: 'front',
          name: 'Mặt tiền',
          items: [
            {
              kind: 'image',
              url: '/media/products/0192f0a0-0000-7000-8000-000000000001/0192f0a0-0000-7000-8000-0000000000aa.jpg',
              caption: 'Ảnh dọc',
            },
          ],
        },
      ],
    });
    const { fetchStub } = stubLodgingApi({
      'GET /lodging/properties': { status: 200, body: { data: [tall] } },
      'GET /lodging/calendar': {
        status: 200,
        body: { from: '2026-11-01', to: '2026-11-08', today: '2026-11-01', properties: [] },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <PropertiesPage />);
    const img = await screen.findByRole('img', { name: tall.name });
    // An absolutely positioned cover cannot stretch its aspect-ratio box (min-height: auto).
    expect(img).toHaveClass('absolute', 'inset-0', 'object-cover');
    expect(img.parentElement).toHaveClass('aspect-[4/3]', 'relative', 'overflow-hidden');
  });

  it('creates a place from the dialog', async () => {
    const calls = stub();
    renderWithRouter(() => <PropertiesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm căn hộ' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Mã căn hộ'), 'B2');
    await userEvent.type(within(dialog).getByLabelText('Tên căn hộ'), 'Villa B2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tạo căn hộ' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /lodging/properties')?.body).toMatchObject({
        code: 'B2',
        name: 'Villa B2',
        sellMode: 'whole',
        standardAdults: 2,
        standardChildren: 0,
      }),
    );
  });
});

describe('PropertiesPage list view', () => {
  it('switches to a compact table and remembers the choice', async () => {
    stub();
    const first = renderWithRouter(() => <PropertiesPage />);
    const group = await screen.findByRole('radiogroup', { name: 'Kiểu xem' });
    expect(within(group).getByRole('radio', { name: 'Thẻ' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await screen.findByRole('article', { name: /A17/ });
    await userEvent.click(within(group).getByRole('radio', { name: 'Danh sách' }));

    const table = await screen.findByRole('table');
    expect(screen.queryByRole('article')).toBeNull();
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Ảnh',
      'Mã',
      'Tên',
      'Địa chỉ',
      'Kiểu bán',
      'Tiêu chuẩn',
      'T2–T5',
      'T6',
      'T7',
      'Hôm nay',
    ]);
    const a17Row = within(table).getByRole('row', { name: /A17/ });
    expect(within(a17Row).getByRole('link', { name: 'Villa A17 Vinpearl' })).toBeInTheDocument();
    expect(within(a17Row).getByText('Lô D33 Sân Golf Tam Đảo, Phú Thọ')).toBeInTheDocument();
    expect(within(a17Row).getByText('Nguyên căn')).toBeInTheDocument();
    expect(within(a17Row).getByText('24 NL + 8 TE')).toBeInTheDocument();
    expect(within(a17Row).getByText('13,2tr')).toBeInTheDocument();
    expect(within(a17Row).getByText('15,4tr')).toBeInTheDocument();
    expect(within(a17Row).getByText('17,6tr')).toBeInTheDocument();
    expect(within(a17Row).getByText('Đang có khách')).toBeInTheDocument();
    expect(within(a17Row).queryByText(/Bot chưa chào bán/)).toBeNull();
    const h1Row = within(table).getByRole('row', { name: /H1/ });
    expect(within(h1Row).getAllByText('Chưa có giá').length).toBeGreaterThan(0);
    expect(within(h1Row).getByText(/Bot chưa chào bán/)).toBeInTheDocument();

    first.unmount();
    renderWithRouter(() => <PropertiesPage />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Danh sách' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('falls back to cards when storage is unavailable', async () => {
    stub();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderWithRouter(() => <PropertiesPage />);
    expect(await screen.findByRole('article', { name: /A17/ })).toBeInTheDocument();
  });
});
