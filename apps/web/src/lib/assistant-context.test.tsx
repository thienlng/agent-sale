import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  collectPageContext,
  fillAssistantForm,
  parseFormNumber,
  requestAssistant,
  useAssistantContext,
  useAssistantForm,
  useAssistantRequest,
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
    expect(result).toEqual({ ok: true, submitTarget: 'products.save', opensDialog: false });
    // "150.000" is 150000 (dots are thousands); "thùng" is not an option and is dropped.
    expect(screen.getByText('Áo thun|150000|cái')).toBeInTheDocument();
  });

  it('reports a form that is not on screen, or not enabled', () => {
    expect(fillAssistantForm('product', { name: 'x' })).toEqual({
      ok: false,
      reason: 'form_not_found',
    });
    render(<FormPage enabled={false} />);
    expect(fillAssistantForm('product', { name: 'x' })).toEqual({
      ok: false,
      reason: 'form_not_found',
    });
    expect(collectPageContext('/app/products/1').forms).toBeUndefined();
  });

  it('waits for a form that registers later, and gives up after the timeout', async () => {
    const waiting = waitForAssistantForm('product', 1000);
    render(<FormPage />);
    await expect(waiting).resolves.toBe(true);
    await expect(waitForAssistantForm('order', 10)).resolves.toBe(false);
  });
});

/** A list that registers `faq` while its add dialog is closed; the open dialog registers it too. */
function FaqListPage({ dialogOpen, list = true }: { dialogOpen: boolean; list?: boolean }) {
  const [opened, setOpened] = useState('');
  useAssistantForm(
    'faq',
    () => [{ name: 'question', label: 'Câu hỏi (danh sách)', type: 'textarea', empty: true }],
    (values) => setOpened(String(values['question'] ?? '')),
    { opensDialog: true, enabled: list },
  );
  return (
    <>
      <p>opened:{opened}</p>
      {dialogOpen ? <FaqDialogForm /> : null}
    </>
  );
}

function FaqDialogForm() {
  const [question, setQuestion] = useState('');
  useAssistantForm(
    'faq',
    () => [{ name: 'question', label: 'Câu hỏi (hộp thoại)', type: 'textarea', empty: !question }],
    (values) => setQuestion(String(values['question'] ?? '')),
  );
  return <p>dialog:{question}</p>;
}

describe('useAssistantForm stack', () => {
  const labelOf = () => collectPageContext('/app/bots/b/knowledge').forms?.[0]?.fields[0]?.label;

  it('lets an open dialog take over its list registration, and gives it back on close', () => {
    const { rerender, unmount } = render(<FaqListPage dialogOpen={false} />);
    expect(labelOf()).toBe('Câu hỏi (danh sách)');
    rerender(<FaqListPage dialogOpen />);
    expect(labelOf()).toBe('Câu hỏi (hộp thoại)');
    // Each id is listed once, with the active registration's fields.
    expect(collectPageContext('/app/bots/b/knowledge').forms).toHaveLength(1);
    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('faq', { question: 'Giờ mở cửa?' });
    });
    expect(result).toEqual({ ok: true, submitTarget: undefined, opensDialog: false });
    expect(screen.getByText('dialog:Giờ mở cửa?')).toBeInTheDocument();
    expect(screen.getByText('opened:')).toBeInTheDocument();

    rerender(<FaqListPage dialogOpen={false} />);
    expect(labelOf()).toBe('Câu hỏi (danh sách)');
    unmount();
    expect(collectPageContext('/app/bots/b/knowledge').forms).toBeUndefined();
  });

  it('keeps the dialog registered when the list unregisters first', () => {
    const { rerender, unmount } = render(<FaqListPage dialogOpen />);
    rerender(<FaqListPage dialogOpen list={false} />);
    expect(labelOf()).toBe('Câu hỏi (hộp thoại)');
    unmount();
    expect(fillAssistantForm('faq', { question: 'x' })).toEqual({
      ok: false,
      reason: 'form_not_found',
    });
  });

  it('says a fill opens a dialog when the list registered the form', () => {
    render(<FaqListPage dialogOpen={false} />);
    let result: ReturnType<typeof fillAssistantForm> | undefined;
    act(() => {
      result = fillAssistantForm('faq', { question: 'Có ship không?' });
    });
    expect(result).toEqual({ ok: true, submitTarget: undefined, opensDialog: true });
    expect(screen.getByText('opened:Có ship không?')).toBeInTheDocument();
  });
});

describe('requestAssistant', () => {
  it('stores one trimmed request that can be taken once', () => {
    requestAssistant('  Điền mẫu giúp mình  ');
    const taken = useAssistantRequest.getState().take();
    expect(taken).toMatchObject({ text: 'Điền mẫu giúp mình' });
    expect(taken?.id).toEqual(expect.any(String));
    expect(useAssistantRequest.getState().take()).toBeNull();
  });

  it('ignores empty text and caps long text', () => {
    requestAssistant('   ');
    expect(useAssistantRequest.getState().request).toBeNull();
    requestAssistant('a'.repeat(600));
    expect(useAssistantRequest.getState().take()?.text).toHaveLength(500);
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
