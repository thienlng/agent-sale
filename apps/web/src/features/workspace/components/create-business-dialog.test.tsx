import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { CreateBusinessDialog } from './create-business-dialog';

const mocks = vi.hoisted(() => ({
  reloadSession: vi.fn(),
  choose: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  reloadSession: mocks.reloadSession,
  getSession: () => ({ workspaceId: 'ws-old', memberships: [] }),
}));
vi.mock('@/hooks/use-business-switch', () => ({
  useBusinessSwitch: () => ({ busy: false, choose: mocks.choose }),
}));

const NEW_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d77';
const created = {
  id: NEW_ID,
  name: 'Villas',
  industry: 'hotel',
  timezone: 'Asia/Ho_Chi_Minh',
  createdAt: '2026-10-29T00:00:00.000Z',
};

beforeEach(() => {
  mocks.reloadSession.mockReset().mockResolvedValue({});
  mocks.choose.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

function open(onOpenChange = vi.fn()) {
  renderWithProviders(<CreateBusinessDialog open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe('CreateBusinessDialog', () => {
  it('offers every template with a one-line description and no default choice', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Tạo business mới' });
    const radios = within(dialog).getAllByRole('radio');
    expect(radios).toHaveLength(9);
    expect(radios.some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(
      within(dialog).getByText('Khách sạn, homestay, villa: phòng, giá, nhận/trả phòng, đặt cọc'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Bán lẻ, online shop: sản phẩm, giao hàng, đổi trả'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Tạo business' })).toBeDisabled();
  });

  it('creates a lodging business named Villas, reloads memberships and switches to it', async () => {
    const { fetchStub, calls } = stubFetch({ 'POST /workspaces': { status: 201, body: created } });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    const onOpenChange = open();
    await user.type(screen.getByLabelText('Tên business'), '  Villas  ');
    await user.click(screen.getByRole('radio', { name: /Khách sạn \/ homestay/ }));
    await user.click(screen.getByRole('button', { name: 'Tạo business' }));
    await waitFor(() => expect(mocks.choose).toHaveBeenCalledWith(NEW_ID));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe('POST /workspaces');
    expect(calls[0]?.body).toEqual({ name: 'Villas', industry: 'hotel' });
    expect(mocks.reloadSession).toHaveBeenCalledTimes(1);
    expect(mocks.reloadSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.choose.mock.invocationCallOrder[0] ?? 0,
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('sends one request when the button is pressed twice', async () => {
    let release: (r: Response) => void = () => undefined;
    const fetchStub = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Tên business'), 'Villas');
    await user.click(screen.getByRole('radio', { name: /Khách sạn/ }));
    const submit = screen.getByRole('button', { name: 'Tạo business' });
    await user.click(submit);
    await user.click(screen.getByRole('button', { name: /Đang tạo/ }));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    release(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await waitFor(() => expect(mocks.choose).toHaveBeenCalledTimes(1));
  });

  it('keeps the inputs and shows a message when the server refuses', async () => {
    const { fetchStub } = stubFetch({
      'POST /workspaces': { status: 403, body: { error: { code: 'FORBIDDEN', message: 'no' } } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    const onOpenChange = open();
    await user.type(screen.getByLabelText('Tên business'), 'Villas');
    await user.click(screen.getByRole('radio', { name: /Khách sạn/ }));
    await user.click(screen.getByRole('button', { name: 'Tạo business' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bạn không có quyền tạo business mới trong tài khoản này.',
    );
    expect(screen.getByLabelText('Tên business')).toHaveValue('Villas');
    expect(screen.getByRole('radio', { name: /Khách sạn/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('does not submit a blank name', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Tên business'), '   ');
    await user.click(screen.getByRole('radio', { name: /Bán lẻ/ }));
    expect(screen.getByRole('button', { name: 'Tạo business' })).toBeDisabled();
  });
});
