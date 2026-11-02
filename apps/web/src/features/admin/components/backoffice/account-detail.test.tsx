import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { AccountDetail } from './account-detail';
import { ACCOUNT_ID, account, plan } from './fixtures';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
beforeAll(async () => {
  await loadNamespace('backoffice');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

const base = `/admin/accounts/${ACCOUNT_ID}`;

function setup(routes: Record<string, { status: number; body?: unknown }> = {}) {
  const stub = stubFetch({
    [`GET ${base}`]: { status: 200, body: account() },
    'GET /admin/plans': { status: 200, body: { data: [plan()] } },
    ...routes,
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <AccountDetail accountId={ACCOUNT_ID} />);
  return stub.calls;
}

describe('AccountDetail', () => {
  it('shows the plan, the usage meter and the businesses', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Shop Lan' })).toBeInTheDocument();
    expect(screen.getByText('Pro · v2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tin AI trong chu kỳ' })).toBeInTheDocument();
    expect(screen.getByText('Shop Lan Q1')).toBeInTheDocument();
  });

  it('says so when the account does not exist', async () => {
    setup({
      [`GET ${base}`]: { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no' } } },
    });
    expect(await screen.findByText('Không tìm thấy tài khoản')).toBeInTheDocument();
  });

  it('suspends only with a reason', async () => {
    const calls = setup({ [`POST ${base}/status`]: { status: 204 } });
    await userEvent.click(await screen.findByRole('button', { name: 'Tạm khoá' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Tạm khoá' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Lý do'), 'unpaid invoice');
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(calls.find((c) => c.key === `POST ${base}/status`)?.body).toEqual({
        status: 'suspended',
        reason: 'unpaid invoice',
      }),
    );
  });

  it('extends a trial with expectedVersion; a 409 toasts the conflict and refetches the account', async () => {
    const calls = setup({
      [`POST ${base}/trial`]: {
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'version changed' } },
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Gia hạn dùng thử' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Lưu' });

    // A day before the current end is refused.
    await userEvent.type(within(dialog).getByLabelText(/Dùng thử đến hết ngày/), '2026-11-01');
    expect(save).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(/Dùng thử đến hết ngày/));
    await userEvent.type(within(dialog).getByLabelText(/Dùng thử đến hết ngày/), '2026-11-15');
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Lý do'), 'needs a demo');
    await userEvent.click(save);

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        'Dữ liệu vừa được người khác thay đổi. Đã tải lại, vui lòng kiểm tra và thử lại.',
      ),
    );
    expect(calls.find((c) => c.key === `POST ${base}/trial`)?.body).toMatchObject({
      expectedVersion: 4,
      reason: 'needs a demo',
    });
    await waitFor(() => expect(calls.filter((c) => c.key === `GET ${base}`).length).toBe(2));
  });
});
