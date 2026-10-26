import type { VariantOption } from '@agent-sales/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatVnd } from '@/lib/format';
import { renderWithProviders } from '@/testing/render';
import { ProductShare } from './product-share';
const mocks = vi.hoisted(() => ({ fail: false, refetch: vi.fn() }));
vi.mock('../api/commerce', () => ({
  useWarehouses: () => ({
    data: [{ id: 'warehouse', name: 'Main warehouse', isDefault: true }],
    isPending: false,
    isError: mocks.fail,
    refetch: mocks.refetch,
  }),
}));
vi.mock('./order-lines', () => ({
  ProductPicker: ({ onPick }: { onPick: (variant: VariantOption) => void }) => (
    <button
      onClick={() =>
        onPick({
          variantId: 'variant',
          productId: 'product',
          productCode: 'SHIRT',
          productName: 'Linen shirt',
          variantName: 'White / M',
          sku: 'SHIRT-M',
          price: 250000,
          available: 12,
        })
      }
    >
      Select catalog variant
    </button>
  ),
}));
beforeEach(() => {
  mocks.fail = false;
  mocks.refetch.mockReset();
});
describe('ProductShare', () => {
  it('inserts the selected variant facts for review instead of sending a message', async () => {
    const insert = vi.fn();
    renderWithProviders(<ProductShare onInsert={insert} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sản phẩm' }));
    expect(insert).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Select catalog variant'));
    expect(insert).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(`Linen shirt · White / M\nGiá: ${formatVnd(250000)}`);
  });
  it('shows a retry when the catalog warehouse cannot be loaded', async () => {
    mocks.fail = true;
    renderWithProviders(<ProductShare onInsert={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sản phẩm' }));
    expect(screen.getByRole('alert')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
