import type { OrderSummaryDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { formatVnd } from '@/lib/format';
import { renderWithProviders } from '@/testing/render';

import { OrderItemsHoverCard } from './order-items-hover-card';

const LONG = 'Áo sơ mi linen tay dài cổ tàu màu trắng ngà dáng suông rộng';
const order = {
  code: 'DH0042',
  amounts: { total: 480_000 } as OrderSummaryDto['amounts'],
  itemsPreview: [
    {
      name: `${LONG} – Size M`,
      qty: 2,
      variantName: 'Size M',
      unitPrice: 165_000,
      imageUrl: 'https://cdn.example.com/ao.jpg',
    },
    { name: 'Túi tote canvas', qty: 1, variantName: null, unitPrice: 150_000, imageUrl: null },
  ],
};

/** Text with every kind of space (the currency uses a no-break space) as one plain space. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/gu, ' ');

function renderCard() {
  renderWithProviders(<OrderItemsHoverCard order={order} />);
  return screen.getByRole('group', { name: 'Chi tiết sản phẩm của đơn DH0042' });
}

const findCard = async () =>
  (await screen.findByText('2 sản phẩm', undefined, { timeout: 3000 })).closest(
    '[data-slot="hover-card-content"]',
  ) as HTMLElement;

describe('OrderItemsHoverCard (products column)', () => {
  it('keeps one truncated `qty× name` line per item in the cell', () => {
    const trigger = renderCard();
    const lines = trigger.querySelectorAll('.truncate');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent(`2× ${LONG} – Size M`);
  });

  it('opens on keyboard focus with full names, variant, qty × price, picture or fallback, and the total', async () => {
    const trigger = renderCard();
    await userEvent.setup().tab();
    expect(trigger).toHaveFocus();
    const card = await findCard();
    expect(trigger).toHaveAttribute('aria-describedby', card.id);

    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(LONG)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Size M')).toBeInTheDocument();
    expect(plain(rows[0]!.textContent)).toContain(plain(`2 × ${formatVnd(165_000)}`));
    const img = rows[0]!.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/ao.jpg');
    expect(img).toHaveAttribute('width', '40');
    expect(img).toHaveAttribute('height', '40');
    expect(img).toHaveAttribute('loading', 'lazy');

    expect(within(rows[1]!).getByText('Túi tote canvas')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('img', { name: 'Chưa có ảnh' })).toBeInTheDocument();
    expect(plain(rows[1]!.textContent)).toContain(plain(`1 × ${formatVnd(150_000)}`));

    expect(plain(within(card).getByText('Tổng đơn').parentElement?.textContent)).toBe(
      plain(`Tổng đơn${formatVnd(480_000)}`),
    );
  });

  it('opens on hover and closes with Escape', async () => {
    const user = userEvent.setup();
    const trigger = renderCard();
    await user.hover(trigger);
    await findCard();
    trigger.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('2 sản phẩm')).toBeNull());
  });

  it('falls back to the package icon when a picture fails to load', async () => {
    renderCard();
    await userEvent.setup().tab();
    const card = await findCard();
    const img = card.querySelector('img')!;
    img.dispatchEvent(new Event('error'));
    await waitFor(() =>
      expect(within(card).getAllByRole('img', { name: 'Chưa có ảnh' })).toHaveLength(2),
    );
  });
});
