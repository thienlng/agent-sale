import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  collectPageContext,
  fillAssistantForm,
  parseFormNumber,
  useAssistantContext,
  useAssistantForm,
  waitForAssistantForm,
} from './assistant-context';

function ProductPage() {
  useAssistantContext({ title: 'Áo thun', entity: { productId: 'p-1' }, emptyFields: ['price'] });
  return (
    <>
      <button data-assistant-target="products.new">Thêm</button>
      <button data-assistant-target="products.new">Thêm</button>
      <button data-assistant-target="products.import">Nhập</button>
    </>
  );
}

/** A small form page with its own state, registered as `product`. */
function FormPage({ enabled = true }: { enabled?: boolean }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [unit, setUnit] = useState('cái');
  useAssistantForm(
    'product',
    () => [
      { name: 'name', label: 'Tên', type: 'text', empty: !name },
      { name: 'price', label: 'Giá', type: 'number', empty: !price },
      { name: 'unit', label: 'Đơn vị', type: 'select', options: ['cái', 'hộp'], empty: false },
    ],
    (values) => {
      if (typeof values['name'] === 'string') setName(values['name']);
      if (typeof values['price'] === 'number') setPrice(values['price']);
      if (typeof values['unit'] === 'string') setUnit(values['unit']);
    },
    { submitTarget: 'products.save', enabled },
  );
  return (
    <p>
      {name}|{price}|{unit}
    </p>
  );
}

describe('useAssistantContext', () => {
  it('sends what the page said, its route and the targets on screen, until it unmounts', () => {
    const { unmount } = render(<ProductPage />);
    expect(collectPageContext('/app/products/p-1')).toEqual({
      title: 'Áo thun',
      entity: { productId: 'p-1' },
      emptyFields: ['price'],
      route: '/app/products/p-1',
      targets: ['products.new', 'products.import'],
    });
    unmount();
    expect(collectPageContext('/app/orders')).toEqual({ route: '/app/orders' });
  });
});

describe('useAssistantForm', () => {
  it('puts the registered form in the page context, with `empty` read at send time', () => {
    const { unmount } = render(<FormPage />);
    expect(collectPageContext('/app/products/new').forms).toEqual([
      {
        id: 'product',
        fields: [
          { name: 'name', label: 'Tên', type: 'text', empty: true },
          { name: 'price', label: 'Giá', type: 'number', empty: true },
          { name: 'unit', label: 'Đơn vị', type: 'select', options: ['cái', 'hộp'], empty: false },
        ],
      },
    ]);
    act(() => {
      fillAssistantForm('product', { name: 'Áo thun' });
    });
    expect(collectPageContext('/app/products/new').forms?.[0]?.fields[0]).toMatchObject({
      name: 'name',
      empty: false,
    });
    unmount();
    expect(collectPageContext('/app/products/new').forms).toBeUndefined();
  });

  it('fills only known fields, coerced to their type, and names the submit button', () => {
    render(<FormPage />);
    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('product', {
        name: 'Áo thun',
        price: '150.000',
        unit: 'thùng',
        secret: 'x',
      });
    });
    expect(result).toEqual({ ok: true, submitTarget: 'products.save' });
    // "150.000" is 150000 (dots are thousands); "thùng" is not an option and is dropped.
    expect(screen.getByText('Áo thun|150000|cái')).toBeInTheDocument();
  });

  it('reports a form that is not on screen, or not enabled', () => {
    expect(fillAssistantForm('product', { name: 'x' })).toEqual({ ok: false });
    render(<FormPage enabled={false} />);
    expect(fillAssistantForm('product', { name: 'x' })).toEqual({ ok: false });
    expect(collectPageContext('/app/products/1').forms).toBeUndefined();
  });

  it('waits for a form that registers later, and gives up after the timeout', async () => {
    const waiting = waitForAssistantForm('product', 1000);
    render(<FormPage />);
    await expect(waiting).resolves.toBe(true);
    await expect(waitForAssistantForm('order', 10)).resolves.toBe(false);
  });
});

describe('parseFormNumber', () => {
  it.each([
    ['150.000', 150_000],
    ['1.234.567', 1_234_567],
    ['150.000đ', 150_000],
    ['12.5', 12.5],
    ['0.75', 0.75],
    ['12,5', 12.5],
    ['1.234,56', 1234.56],
    ['150,000', 150_000],
    ['1 500 000 ₫', 1_500_000],
    ['-2.5', -2.5],
    ['42', 42],
  ])('reads %s as %s', (raw, n) => {
    expect(parseFormNumber(raw)).toBe(n);
  });

  it.each(['', 'abc', '1.2.3'])('refuses %j', (raw) => {
    expect(parseFormNumber(raw)).toBeNaN();
  });
});
