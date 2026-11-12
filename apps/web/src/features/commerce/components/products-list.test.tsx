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
  it('names the page "Dịch vụ" for an education or spa business, like the sidebar', async () => {
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([]),
    });
    vi.stubGlobal('fetch', fetchStub);
    const view = renderWithRouter(() => <ProductsList offeringKind="course" />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Dịch vụ');
    expect(screen.getByRole('link', { name: 'Thêm dịch vụ' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Tên dịch vụ' })).toBeVisible();
    expect(await screen.findByText(/Chưa có dịch vụ nào/)).toBeVisible();
    view.unmount();
    renderWithRouter(() => <ProductsList offeringKind="service" />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Dịch vụ');
    expect(screen.getByRole('link', { name: 'Thêm dịch vụ' })).toBeVisible();
    expect(screen.getByPlaceholderText('Tìm theo tên, mã dịch vụ hoặc SKU')).toBeVisible();
  });

  it('keeps the products title for a shop', async () => {
    setup(undefined);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Sản phẩm');
  });

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

  it("shows a service's package count only from two packages (MS2-9)", async () => {
    const one = { ...product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f21', 'DV21', 'Gội đầu', false) };
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([one]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList offeringKind="service" />);
    await screen.findByText('Gội đầu');
    expect(screen.queryByRole('columnheader', { name: 'Số gói' })).toBeNull();
    expect(screen.queryByText(/gói$/)).toBeNull();
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

  it('shows the price note, or "Liên hệ", instead of a 0 price of a course or service', async () => {
    const offering = (priceNote: string) => ({
      kind: 'course',
      durationMinutes: null,
      sessions: null,
      period: '',
      format: null,
      level: '',
      schedule: '',
      audience: '',
      outcomes: [],
      priceNote,
    });
    const free = (id: string, code: string, name: string) => ({
      ...product(id, code, name, false),
      priceMin: 0,
      priceMax: 0,
    });
    const ASK = {
      ...free('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f05', 'KH02', 'Starters'),
      offering: offering(''),
    };
    const NOTED = {
      ...free('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f06', 'KH03', 'Movers'),
      offering: offering('theo lộ trình'),
    };
    const PRICED = {
      ...product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f07', 'KH04', 'Flyers', false),
      offering: offering('giá tham khảo'),
    };
    const LEGACY = free('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f08', 'KH05', 'IELTS');
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([ASK, NOTED, PRICED, LEGACY]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList offeringKind="course" />);
    // Every course has a single package here, so the package column is hidden (MS2-9).
    const price = (name: string) =>
      within(screen.getByText(name).closest('tr') as HTMLElement).getAllByRole('cell')[2];
    await screen.findByText('Starters');
    expect(price('Starters')).toHaveTextContent(/^Liên hệ$/);
    expect(price('Movers')).toHaveTextContent(/^theo lộ trình$/);
    expect(price('Flyers')).toHaveTextContent('100.000 ₫ (giá tham khảo)');
    expect(price('IELTS')).toHaveTextContent(/^Liên hệ$/);
    expect(screen.queryByText(/^0\s?₫$/)).toBeNull();
  });

  it('shows no stock for a product without offering in an education or spa business', async () => {
    const LEGACY = { ...SHOE, available: 0 };
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([LEGACY]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList offeringKind="service" />);
    const row = (await screen.findByText('Giày sneaker')).closest('tr') as HTMLElement;
    const stock = within(row).getAllByRole('cell').at(-1) as HTMLElement;
    expect(stock).toHaveTextContent(/^—$/);
    expect(stock).not.toHaveClass('text-destructive');
  });

  it('leaves the 0-priced variants out of the price range of a course or service', async () => {
    const variant = (id: string, price: number) => ({
      id,
      sku: id.slice(-4),
      name: '',
      price,
      cost: 0,
      weightGram: 0,
      stock: [],
    });
    const MIXED = {
      ...product('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f09', 'DV02', 'Nâng mũi', false),
      priceMin: 0,
      priceMax: 9_000_000,
      variants: [
        variant('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f10', 0),
        variant('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f11', 9_000_000),
      ],
    };
    const RANGE = {
      ...MIXED,
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f12',
      code: 'DV03',
      name: 'Triệt lông',
      variants: [
        variant('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f13', 0),
        variant('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f14', 2_000_000),
        variant('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f15', 9_000_000),
      ],
    };
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([MIXED, RANGE]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList offeringKind="service" />);
    const price = (name: string) =>
      within(screen.getByText(name).closest('tr') as HTMLElement).getAllByRole('cell')[3];
    await screen.findByText('Nâng mũi');
    expect(price('Nâng mũi')).toHaveTextContent(/^9\.000\.000\s?₫ · có gói liên hệ$/);
    expect(price('Triệt lông')).toHaveTextContent(
      /^2\.000\.000\s?₫ – 9\.000\.000\s?₫ · có gói liên hệ$/,
    );
  });

  it('keeps a 0 price of a shop product as it is', async () => {
    const { fetchStub } = stubFetch({
      'GET /products?status=active&page=1&pageSize=20': page([
        { ...SHOE, priceMin: 0, priceMax: 0 },
      ]),
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ProductsList pmsLink={undefined} />);
    const row = (await screen.findByText('Giày sneaker')).closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent(/^0\s?₫$/);
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
