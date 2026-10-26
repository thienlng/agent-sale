import type { CreateOrderRequest, VariantOption } from '@agent-sales/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderForm } from './order-form';
import type { PeopleState } from './order-people';

const mocks = vi.hoisted(() => ({ create: vi.fn(), navigate: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate, Link: () => null }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { id: 'sale' }, workspaceId: 'shop' }),
}));
vi.mock('../api/commerce', () => ({
  useWarehouses: () => ({
    data: [{ id: 'warehouse', name: 'Main', isDefault: true }],
    isPending: false,
  }),
  useCreateOrder: () => ({ mutateAsync: mocks.create, isPending: false }),
}));
vi.mock('../hooks/use-order-statuses', () => ({
  useOrderStatuses: () => ({ statuses: ['new'] }),
  useRequiredOrderFields: () => new Set(),
}));
vi.mock('./order-lines', () => ({
  ProductPicker: ({ onPick }: { onPick: (variant: VariantOption) => void }) => (
    <button
      type="button"
      onClick={() =>
        onPick({
          variantId: 'variant',
          productId: 'product',
          productCode: 'SHIRT',
          productName: 'Shirt',
          variantName: 'M',
          sku: 'SHIRT-M',
          price: 150000,
          available: 10,
        })
      }
    >
      Pick shirt
    </button>
  ),
  OrderLines: ({ lines }: { lines: { qty: number }[] }) => <p>Lines: {lines.length}</p>,
}));
vi.mock('./order-payment', () => ({ PaymentPanel: () => null }));
vi.mock('./order-people', () => ({
  OrderPeoplePanels: ({
    value,
    onChange,
  }: {
    value: PeopleState;
    onChange: (value: PeopleState) => void;
  }) => (
    <input
      aria-label="Customer name"
      required
      value={value.customer.name}
      onChange={(event) =>
        onChange({ ...value, customer: { ...value.customer, name: event.target.value } })
      }
    />
  ),
}));
beforeEach(() => {
  mocks.create.mockReset();
  mocks.navigate.mockReset();
});

describe('Embedded inbox order', () => {
  it('keeps customer, products and idempotency key when a failed draft is reopened', async () => {
    mocks.create.mockRejectedValue(new Error('offline'));
    const context = {
      draftKey: 'restore-order',
      customerName: 'Customer A',
      source: 'facebook' as const,
    };
    const first = render(<OrderForm context={context} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('Pick shirt'));
    fireEvent.change(screen.getByLabelText('Customer name'), {
      target: { value: 'Edited customer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'orderForm.submit' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'orderForm.submit' })).toBeEnabled(),
    );
    const request = mocks.create.mock.calls[0]?.[0] as CreateOrderRequest;
    first.unmount();
    render(<OrderForm context={context} onCreated={vi.fn()} />);
    expect(screen.getByLabelText('Customer name')).toHaveValue('Edited customer');
    expect(screen.getByText('Lines: 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'orderForm.submit' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]?.[0]).toEqual(request);
  });

  it('records a successful order and clears its draft even after switching conversations', async () => {
    let resolve: (order: { id: string; code: string }) => void = () => {};
    mocks.create.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onCreated = vi.fn();
    const context = {
      draftKey: 'inflight-order',
      customerName: 'Customer A',
      source: 'facebook' as const,
    };
    const first = render(<OrderForm context={context} onCreated={onCreated} />);
    fireEvent.click(screen.getByText('Pick shirt'));
    fireEvent.click(screen.getByRole('button', { name: 'orderForm.submit' }));
    first.unmount();
    const reopened = render(<OrderForm context={context} onCreated={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('orderForm.submitting');
    await act(async () => resolve({ id: 'created-order', code: 'DH001' }));
    expect(onCreated).toHaveBeenCalledWith({ id: 'created-order', code: 'DH001' });
    expect(mocks.navigate).not.toHaveBeenCalled();
    reopened.unmount();
    render(<OrderForm context={context} onCreated={vi.fn()} />);
    expect(screen.getByText('Lines: 0')).toBeVisible();
  });

  it('does not submit an embedded order with F2 outside the visible form', async () => {
    render(
      <OrderForm
        context={{ draftKey: 'hidden-order', customerName: 'Customer A', source: 'facebook' }}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Pick shirt'));
    fireEvent.keyDown(window, { key: 'F2' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
