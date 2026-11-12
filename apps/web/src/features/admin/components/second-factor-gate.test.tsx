import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter, stepUpStatus, stubFetch } from '@/testing/render';

import { SecondFactorGate } from './second-factor-gate';

beforeAll(() => loadNamespace('backoffice'));
afterEach(() => vi.unstubAllGlobals());

function render(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes);
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => (
    <SecondFactorGate>
      <p>Back office</p>
    </SecondFactorGate>
  ));
  return stub.calls;
}

describe('SecondFactorGate', () => {
  it('opens the back office for a sign-in that passed two-step verification', async () => {
    render({
      'GET /auth/reauth': { status: 200, body: stepUpStatus({ methods: ['totp'], mfa: true }) },
    });
    expect(await screen.findByText('Back office')).toBeInTheDocument();
  });

  it('sends an admin without two-step verification to account security', async () => {
    render({ 'GET /auth/reauth': { status: 200, body: stepUpStatus() } });
    expect(await screen.findByText('Hãy bật xác minh hai bước')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở Bảo mật tài khoản' })).toHaveAttribute(
      'href',
      '/app/settings/security',
    );
    expect(screen.queryByText('Back office')).toBeNull();
  });

  it('asks an enrolled admin for an authenticator code, then opens the back office', async () => {
    const calls = render({
      'GET /auth/reauth': { status: 200, body: stepUpStatus({ methods: ['totp'] }) },
      'POST /auth/reauth': {
        status: 200,
        body: stepUpStatus({ methods: ['totp'], recent: true, mfa: true }),
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nhập mã' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận đó là bạn' });
    await user.type(within(dialog).getByLabelText('Mã xác minh hoặc mã khôi phục'), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Back office')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /auth/reauth')?.body).toEqual({ code: '123456' });
  });
});
