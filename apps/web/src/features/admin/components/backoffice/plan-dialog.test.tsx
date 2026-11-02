import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { plan as planFixture } from './fixtures';
import { PlanDialog } from './plan-dialog';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
beforeAll(async () => {
  await loadNamespace('backoffice');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  toasts.success.mockReset();
  toasts.error.mockReset();
});

function setup(
  plan: ReturnType<typeof planFixture> | null,
  post: { status: number; body: unknown } = { status: 201, body: planFixture() },
) {
  const stub = stubFetch({
    'POST /admin/plans': post,
    'POST /admin/plans/pro/versions': post,
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  const onOpenChange = vi.fn();
  renderWithProviders(<PlanDialog open plan={plan} onOpenChange={onOpenChange} />);
  return { calls: stub.calls, onOpenChange };
}

const reason = () => screen.getByLabelText('Lý do');
const posts = <C extends { key: string }>(calls: C[]) =>
  calls.filter((c) => c.key.startsWith('POST'));

describe('PlanDialog', () => {
  it('keeps submit disabled until a reason of at least 3 characters is given', async () => {
    setup(null);
    const submit = screen.getByRole('button', { name: 'Tạo gói' });
    expect(submit).toBeDisabled();
    await userEvent.type(reason(), 'ab');
    expect(submit).toBeDisabled();
    await userEvent.type(reason(), 'c');
    expect(submit).toBeEnabled();
  });

  it('rejects an invalid plan code and an empty limit without calling the API', async () => {
    const { calls } = setup(null);
    await userEvent.type(screen.getByLabelText('Tên gói'), 'Pro');
    await userEvent.type(screen.getByLabelText('Mã gói'), 'Pro-1');
    await userEvent.clear(screen.getByLabelText('Số thành viên'));
    await userEvent.type(reason(), 'new plan');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo gói' }));

    expect(screen.getByText('Mã gói không hợp lệ')).toBeInTheDocument();
    expect(screen.getByLabelText('Số thành viên')).toHaveAttribute('aria-invalid', 'true');
    expect(posts(calls)).toEqual([]);
  });

  it('posts a complete, contract-shaped plan', async () => {
    const { calls, onOpenChange } = setup(null);
    await userEvent.type(screen.getByLabelText('Tên gói'), 'Pro');
    await userEvent.type(screen.getByLabelText('Mã gói'), 'pro_max');
    await userEvent.type(screen.getByLabelText('1 tháng'), '499000');
    await userEvent.clear(screen.getByLabelText('Số thành viên'));
    await userEvent.type(screen.getByLabelText('Số thành viên'), '5');
    await userEvent.type(reason(), 'launch the plan');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo gói' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const body = posts(calls)[0]?.body as Record<string, unknown> & {
      entitlements: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      code: 'pro_max',
      name: 'Pro',
      priceByPeriod: { '1': 499000 },
      reason: 'launch the plan',
    });
    expect(body.entitlements['members.max']).toBe(5);
    expect(body.entitlements['ai.models.allowed']).toEqual(['smart']);
  });

  it('publishes the next version with expectedVersion and shows the conflict toast on 409', async () => {
    const { calls, onOpenChange } = setup(planFixture(), {
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'version changed' } },
    });
    expect(screen.getByLabelText('Mã gói')).toBeDisabled();
    await userEvent.type(reason(), 'raise the price');
    await userEvent.click(screen.getByRole('button', { name: 'Phát hành phiên bản 3' }));

    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        'Dữ liệu vừa được người khác thay đổi. Đã tải lại, vui lòng kiểm tra và thử lại.',
      ),
    );
    expect(posts(calls)[0]).toMatchObject({
      key: 'POST /admin/plans/pro/versions',
      body: { expectedVersion: 2 },
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
