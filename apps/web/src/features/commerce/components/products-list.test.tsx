import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { ProductsList, type PmsLink } from './products-list';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  can.value = true;
});

const product = (id: string, code: string, name: string, linked: boolean) => ({
  id,
  code,
  name,
  description: '',
  category: null,
  status: 'active',
  visibleToBot: true,
  botInstructions: '',
  imageUrls: [],
  variants: [],
  external: linked ? { source: 'kiotviet', id: '9001' } : null,
  priceMin: 100_000,
  priceMax: 100_000,
  available: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const page = (data: unknown[]) => ({
  status: 200,
  body: { data, total: data.length, page: 1, pageSize: 20 },
});
const SHIRT = product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01', 'SM01', 'Sơ mi trắng', true);
const SHOE = product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f02', 'GI01', 'Giày sneaker', false);

function setup(pmsLink: PmsLink | null | undefined) {
  const { fetchStub, calls } = stubFetch({
    'GET /products?status=active&page=1&pageSize=20': page([SHIRT, SHOE]),
    'GET /products?status=active&page=1&source=kiotviet&pageSize=20': page([SHIRT]),
  });
  vi.stubGlobal('fetch', fetchStub);
  const view = renderWithRouter(() => <ProductsList pmsLink={pmsLink} />);
  return { calls, view };
}

const LINK = { retailer: 'shopabc', lastSyncAt: new Date(Date.now() - 120_000).toISOString() };

describe('ProductsList', () => {
  it('marks products synced from KiotViet with a badge', async () => {
    setup(LINK);
    const linkedRow = (await screen.findByText('Sơ mi trắng')).closest('tr');
    const otherRow = screen.getByText('Giày sneaker').closest('tr');
    expect(linkedRow).toHaveTextContent('KiotViet');
    expect(otherRow).not.toHaveTextContent('KiotViet');
  });

  it('renders products from an API that predates the PMS link (no `external` key)', async () => {
    const { external: _ignored, ...legacy } = SHOE;
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([legacy]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList pmsLink={null} />);
    const row = (await screen.findByText('Giày sneaker')).closest('tr');
    expect(row).not.toHaveTextContent('KiotViet');
  });

  it('shows the length and sessions of a course or service instead of its stock', async () => {
    const offering = (o: Record<string, unknown>) => ({
      kind: 'service',
      durationMinutes: null,
      sessions: null,
      period: '',
      format: null,
      level: '',
      schedule: '',
      audience: '',
      outcomes: [],
      priceNote: '',
      ...o,
    });
    const FACIAL = {
      ...product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f03', 'DV01', 'Chăm sóc da', false),
      offering: offering({ durationMinutes: 60, sessions: 10 }),
    };
    const COURSE = {
      ...product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f04', 'KH01', 'IELTS 6.5', false),
      offering: offering({ kind: 'course', period: '3 tháng' }),
    };
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([FACIAL, COURSE, SHOE]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList pmsLink={undefined} />);
    const facial = (await screen.findByText('Chăm sóc da')).closest('tr') as HTMLElement;
    const cells = within(facial).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('60 phút · 10 buổi');
    const course = screen.getByText('IELTS 6.5').closest('tr') as HTMLElement;
    expect(within(course).getAllByRole('cell').at(-1)).toHaveTextContent('3 tháng');
    const shoe = screen.getByText('Giày sneaker').closest('tr') as HTMLElement;
    expect(within(shoe).getAllByRole('cell').at(-1)).toHaveTextContent('3');
    expect(screen.getByRole('columnheader', { name: 'Có thể bán / Thời lượng' })).toBeVisible();
  });

  it('filters by source once connected', async () => {
    const { calls } = setup(LINK);
    await screen.findByText('Giày sneaker');
    const group = screen.getByRole('group', { name: 'Nguồn' });
    await userEvent.click(within(group).getByRole('button', { name: 'KiotViet' }));
    await waitFor(() =>
      expect(calls.map((c) => c.key)).toContain(
        'GET /products?status=active&page=1&source=kiotviet&pageSize=20',
      ),
    );
    await waitFor(() => expect(screen.queryByText('Giày sneaker')).toBeNull());
  });

  it('shows a slim sync bar when connected and no hint', async () => {
    setup(LINK);
    expect(await screen.findByText(/Đồng bộ với KiotViet · 2 phút trước/)).toBeInTheDocument();
    expect(screen.queryByText('Đang dùng KiotViet? Nhập sản phẩm tự động')).toBeNull();
  });

  it('offers KiotViet when not connected and remembers the dismissal', async () => {
    const { view } = setup(null);
    expect(
      await screen.findByText('Đang dùng KiotViet? Nhập sản phẩm tự động'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kết nối KiotViet' })).toHaveAttribute(
      'href',
      '/app/integrations',
    );
    expect(screen.queryByRole('group', { name: 'Nguồn' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn gợi ý' }));
    expect(screen.queryByText('Đang dùng KiotViet? Nhập sản phẩm tự động')).toBeNull();
    expect(window.localStorage.getItem('rapiz.pmsHint.dismissed.ws-1')).toBe('1');

    view.unmount();
    setup(null);
    await screen.findByText('Giày sneaker');
    expect(screen.queryByText('Đang dùng KiotViet? Nhập sản phẩm tự động')).toBeNull();
  });

  it('shows no hint while the connection is unknown or to members who cannot manage the catalog', async () => {
    const { view } = setup(undefined);
    await screen.findByText('Giày sneaker');
    expect(screen.queryByText('Đang dùng KiotViet? Nhập sản phẩm tự động')).toBeNull();
    view.unmount();

    can.value = false;
    setup(null);
    await screen.findByText('Giày sneaker');
    expect(screen.queryByText('Đang dùng KiotViet? Nhập sản phẩm tự động')).toBeNull();
  });
});
