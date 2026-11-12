import type { ProductDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { DeleteProductSection } from './delete-product';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockReset();
  toast.error.mockReset();
});

const ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01';
const VARIANT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b01';
const product = (over: Partial<ProductDto> = {}): ProductDto => ({
  id: ID,
  code: 'SM01',
  name: 'Sơ mi trắng',
  description: 'Vải cotton',
  category: 'Áo',
  status: 'active',
  visibleToBot: true,
  botInstructions: '',
  imageUrls: [],
  offering: null,
  variants: [
    {
      id: VARIANT,
      sku: 'SM01-M',
      name: 'Size M',
      price: 250_000,
      cost: 120_000,
      weightGram: 300,
      stock: [],
    },
  ],
  external: null,
  priceMin: 250_000,
  priceMax: 250_000,
  available: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});
const refused = (reason: string) => ({
  status: 409,
  body: { error: { code: 'CONFLICT', message: 'refused', details: { reason } } },
});

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Xoá sản phẩm' }));
  return screen.findByRole('alertdialog', { name: 'Xoá sản phẩm SM01 · Sơ mi trắng?' });
}

describe('DeleteProductSection', () => {
  it('names the product, says it cannot be undone, deletes it and leaves the page', async () => {
    const { fetchStub, calls } = stubFetch({ [`DELETE /products/${ID}`]: { status: 204 } });
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    renderWithRouter(() => <DeleteProductSection product={product()} onDeleted={onDeleted} />);
    const dialog = await openDialog();
    expect(within(dialog).getByText(/Không thể hoàn tác/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(calls.map((c) => c.key)).toEqual([`DELETE /products/${ID}`]);
    expect(toast.success).toHaveBeenCalledWith('Đã xoá sản phẩm SM01 · Sơ mi trắng.');
  });

  it('archives a product that is in orders in one click instead', async () => {
    const archived = product({ status: 'archived' });
    const { fetchStub, calls } = stubFetch({
      [`DELETE /products/${ID}`]: refused('product_in_orders'),
      [`PUT /products/${ID}`]: { status: 200, body: archived },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onDeleted = vi.fn();
    const onArchived = vi.fn();
    renderWithRouter(() => (
      <DeleteProductSection product={product()} onDeleted={onDeleted} onArchived={onArchived} />
    ));
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));

    expect(
      await within(dialog).findByText(/đã có trong đơn hàng nên không xoá được/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu trữ sản phẩm' }));
    await waitFor(() => expect(onArchived).toHaveBeenCalledOnce());
    expect(calls.find((c) => c.key === `PUT /products/${ID}`)?.body).toMatchObject({
      code: 'SM01',
      name: 'Sơ mi trắng',
      status: 'archived',
      variants: [{ id: VARIANT, sku: 'SM01-M', price: 250_000, cost: 120_000 }],
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('explains that a KiotViet product is removed in KiotViet and offers no archive', async () => {
    const { fetchStub } = stubFetch({ [`DELETE /products/${ID}`]: refused('product_synced') });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <DeleteProductSection product={product()} onDeleted={vi.fn()} />);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xoá vĩnh viễn' }));
    expect(await within(dialog).findByText(/đồng bộ từ KiotViet/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Lưu trữ sản phẩm' })).toBeNull();
  });
});
