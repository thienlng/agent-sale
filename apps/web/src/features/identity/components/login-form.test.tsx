import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { LoginForm } from './login-form';

afterEach(() => vi.unstubAllGlobals());

describe('LoginForm', () => {
  it('renders in Vietnamese by default', async () => {
    renderWithRouter(() => <LoginForm onSuccess={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Đăng nhập vào Rapiz' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('placeholder', 'Mật khẩu');
    expect(screen.getByLabelText('Email')).toHaveAttribute('placeholder', 'Email');
    expect(screen.getByRole('button', { name: /Google/ })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Đăng ký' })).toHaveAttribute('href', '/signup');
  });

  it('reveals and masks the same password without submitting the form', async () => {
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <LoginForm onSuccess={() => {}} />);
    const password = await screen.findByLabelText('Mật khẩu');
    await userEvent.type(password, 'example-only');
    await userEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('example-only');
    // Nothing was submitted (the page only asks which sign-in methods exist).
    expect(calls.filter((c) => c.key.startsWith('POST'))).toHaveLength(0);
  });

  it('shows one generic message for a wrong email or password', async () => {
    const { fetchStub } = stubFetch({
      'POST /auth/login': {
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'Invalid credentials' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onSuccess = vi.fn();
    renderWithRouter(() => <LoginForm onSuccess={onSuccess} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'lan@shop.vn');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('asks for a verification code after the password, then signs in', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).endsWith('/auth/login')) return new Response(null, { status: 401 });
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      const ok = body['code'] === '123456';
      return new Response(
        JSON.stringify(
          ok
            ? {
                accessToken: 'a.b.c',
                expiresIn: 900,
                user: {
                  id: '0b6b5bd1-4c1b-4f6b-9a56-6e7c4a0a9d11',
                  email: 'lan@shop.vn',
                  name: 'Lan',
                  phone: null,
                  emailVerified: false,
                  locale: 'vi',
                  timezone: 'Asia/Ho_Chi_Minh',
                  isPlatformAdmin: false,
                },
              }
            : {
                error: {
                  code: 'UNAUTHENTICATED',
                  message: 'A verification code is required',
                  details: { reason: body['code'] ? 'mfa_invalid' : 'mfa_required' },
                },
              },
        ),
        { status: ok ? 200 : 401, headers: { 'content-type': 'application/json' } },
      );
    });
    renderWithRouter(() => <LoginForm onSuccess={() => {}} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'lan@shop.vn');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'right password');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('heading', { name: 'Xác minh 2 bước' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Mã xác minh'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Xác minh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã không đúng');

    await userEvent.clear(screen.getByLabelText('Mã xác minh'));
    await userEvent.type(screen.getByLabelText('Mã xác minh'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Xác minh' }));
    // The password is kept from the first step and sent again with the code.
    await vi.waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({ password: 'right password', code: '123456' }),
    );
  });

  const user = {
    id: '0b6b5bd1-4c1b-4f6b-9a56-6e7c4a0a9d11',
    email: 'lan@gmail.com',
    name: 'Lan',
    phone: null,
    emailVerified: true,
    locale: 'vi',
    timezone: 'Asia/Ho_Chi_Minh',
    isPlatformAdmin: false,
  };

  it('links to Google sign-in, keeping the target page, once the server offers it', async () => {
    const { fetchStub } = stubFetch({
      'GET /auth/providers': { status: 200, body: { google: true } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <LoginForm onSuccess={() => {}} redirect="/app/inbox" />);
    const link = await screen.findByRole('link', { name: /Tiếp tục với Google/ });
    expect(link).toHaveAttribute('href', '/api/v1/auth/google/start?redirect=%2Fapp%2Finbox');
  });

  it('shows Google as coming soon when the server does not offer it', async () => {
    const { fetchStub } = stubFetch({
      'GET /auth/providers': { status: 200, body: { google: false } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <LoginForm onSuccess={() => {}} />);
    expect(await screen.findByText('Sắp có')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google/ })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
  });

  it('explains why a Google sign-in came back without a session', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ 'GET /auth/providers': { status: 200, body: { google: true } } }).fetchStub,
    );
    renderWithRouter(() => (
      <LoginForm onSuccess={() => {}} google={{ step: 'error', reason: 'cancelled' }} />
    ));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn đã huỷ đăng nhập với Google.');
  });

  it('asks a two-factor user for the code after Google, then signs in', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /auth/google/mfa': {
        status: 200,
        body: { accessToken: 'a.b.c', expiresIn: 900, user },
      },
      'GET /bootstrap': { status: 200, body: { user, accounts: [], memberships: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onSuccess = vi.fn();
    renderWithRouter(() => <LoginForm onSuccess={onSuccess} google={{ step: 'mfa' }} />);
    expect(await screen.findByRole('heading', { name: 'Xác minh 2 bước' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Mã xác minh'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Xác minh' }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(calls.find((c) => c.key === 'POST /auth/google/mfa')?.body).toEqual({ code: '123456' });
  });

  it('returns to the login form when the pending Google sign-in expired', async () => {
    const { fetchStub } = stubFetch({
      'POST /auth/google/mfa': {
        status: 401,
        body: {
          error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: 'google_expired' } },
        },
      },
      'GET /auth/providers': { status: 200, body: { google: true } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <LoginForm onSuccess={() => {}} google={{ step: 'mfa' }} />);
    await userEvent.type(await screen.findByLabelText('Mã xác minh'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Xác minh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Phiên đăng nhập với Google đã hết hạn',
    );
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument();
  });
});
