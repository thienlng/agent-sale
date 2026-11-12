import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StepUpHost } from '@/components/step-up-dialog';
import { renderWithRouter, stepUpStatus, stubFetchSequence } from '@/testing/render';

import { SecurityPage } from './security-page';

afterEach(() => vi.unstubAllGlobals());

const MFA_OFF = { enabled: false, recoveryCodesLeft: 0 };
const LINK = {
  provider: 'google',
  subject: 'g-123',
  email: 'lan@gmail.com',
  createdAt: '2026-11-01T03:00:00.000Z',
  lastLoginAt: '2026-11-10T03:00:00.000Z',
};
const reauth = {
  status: 403,
  body: { error: { code: 'FORBIDDEN', message: 'x', details: { reason: 'reauth_required' } } },
};

function render(routes: Parameters<typeof stubFetchSequence>[0]) {
  const stub = stubFetchSequence({
    'GET /auth/mfa': { status: 200, body: MFA_OFF },
    'GET /auth/reauth': { status: 200, body: stepUpStatus() },
    'GET /auth/identities': { status: 200, body: { data: [LINK] } },
    ...routes,
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => (
    <>
      <SecurityPage />
      <StepUpHost />
    </>
  ));
  return stub.calls;
}

describe('SecurityPage: linked sign-ins', () => {
  it('lists the linked Google account and removes it after a step-up', async () => {
    const calls = render({
      'DELETE /auth/identities/google/g-123': [reauth, { status: 204 }],
      'POST /auth/reauth': { status: 200, body: stepUpStatus({ recent: true }) },
    });
    const user = userEvent.setup();
    expect(await screen.findByText('Google · lan@gmail.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gỡ lan@gmail.com' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Gỡ' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Xác nhận đó là bạn' });
    await user.type(within(stepUp).getByLabelText('Mật khẩu hiện tại'), 'the password');
    await user.click(within(stepUp).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'DELETE /auth/identities/google/g-123')).toHaveLength(2),
    );
  });

  it('shows when there is nothing linked', async () => {
    render({ 'GET /auth/identities': { status: 200, body: { data: [] } } });
    expect(await screen.findByText('Chưa liên kết cách đăng nhập nào.')).toBeInTheDocument();
  });
});

describe('SecurityPage: two-step verification without a password', () => {
  it('skips the password for a Google-only user and confirms with an emailed code', async () => {
    const calls = render({
      'GET /auth/reauth': {
        status: 200,
        body: stepUpStatus({ methods: ['email'], hasPassword: false }),
      },
      'GET /auth/identities': { status: 200, body: { data: [] } },
      'POST /auth/mfa/setup': [
        reauth,
        { status: 200, body: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' } },
      ],
      'POST /auth/reauth/code': { status: 204 },
      'POST /auth/reauth': { status: 200, body: stepUpStatus({ recent: true }) },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bật xác minh 2 bước' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByPlaceholderText('Mật khẩu hiện tại')).toBeNull();
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Tiếp tục' })).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Tiếp tục' }));

    const stepUp = await screen.findByRole('dialog', { name: 'Xác nhận đó là bạn' });
    await user.click(within(stepUp).getByRole('button', { name: 'Gửi mã qua email' }));
    await user.type(within(stepUp).getByLabelText('Mã đã gửi tới email của bạn'), '123456');
    await user.click(within(stepUp).getByRole('button', { name: 'Xác nhận' }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'POST /auth/mfa/setup').map((c) => c.body)).toEqual([
      {},
      {},
    ]);
  });
});
