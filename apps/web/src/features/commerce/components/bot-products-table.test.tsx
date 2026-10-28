import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { BotCatalogMode } from './bot-catalog-mode';
import { BotProductsTable } from './bot-products-table';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const SHIRT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01';
const SHOE = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f02';
const product = (id: string, code: string, name: string) => ({
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
  priceMin: 100_000,
  priceMax: 100_000,
  available: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const routes = (selected: string[]) => ({
  'GET /products?status=active&page=1&pageSize=10': {
    status: 200,
    body: {
      data: [product(SHIRT, 'SM01', 'Sơ mi trắng'), product(SHOE, 'GI01', 'Giày sneaker')],
      total: 2,
      page: 1,
      pageSize: 10,
    },
  },
  [`GET /bots/${BOT}/products`]: { status: 200, body: { productIds: selected } },
  [`PUT /bots/${BOT}/products`]: { status: 200, body: { productIds: [SHIRT, SHOE] } },
});

describe('BotProductsTable (T-080)', () => {
  it('lists the shared catalog without checkboxes when the bot sells every product', async () => {
    vi.stubGlobal('fetch', stubFetch(routes([])).fetchStub);
    renderWithRouter(() => <BotProductsTable botId={BOT} selecting={false} />);
    await screen.findByText('Sơ mi trắng');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Tổng 2 sản phẩm')).toBeTruthy();
  });

  it('ticks a product for the bot and saves the whole selection', async () => {
    const stub = stubFetch(routes([SHIRT]));
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithRouter(() => <BotProductsTable botId={BOT} selecting />);
    const shoe = await screen.findByRole('checkbox', { name: 'Bot bán Giày sneaker' });
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Bot bán Sơ mi trắng' }).getAttribute('data-state'),
      ).toBe('checked'),
    );
    expect(screen.getByText(/Đã chọn 1 sản phẩm/)).toBeTruthy();
    await userEvent.setup().click(shoe);
    await waitFor(() => {
      const put = stub.calls.find((c) => c.key === `PUT /bots/${BOT}/products`);
      expect((put?.body as { productIds: string[] }).productIds.sort()).toEqual(
        [SHIRT, SHOE].sort(),
      );
    });
    await waitFor(() => expect(shoe.getAttribute('data-state')).toBe('checked'));
  });

  it('warns that the bot will present nothing while no product is selected', async () => {
    vi.stubGlobal('fetch', stubFetch(routes([])).fetchStub);
    renderWithRouter(() => <BotProductsTable botId={BOT} selecting />);
    expect((await screen.findByRole('status')).textContent).toContain(
      'chưa có sản phẩm nào được chọn',
    );
  });
});

describe('BotCatalogMode', () => {
  it('switches between every product and the selection', async () => {
    const onChange = vi.fn();
    renderWithRouter(() => <BotCatalogMode mode="all" onChange={onChange} />);
    await userEvent
      .setup()
      .click(await screen.findByRole('radio', { name: /Chỉ sản phẩm được chọn/ }));
    expect(onChange).toHaveBeenCalledWith('selected');
  });
});
