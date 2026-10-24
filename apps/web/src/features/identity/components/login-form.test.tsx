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
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng ký' })).toHaveAttribute('href', '/signup');
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
});
