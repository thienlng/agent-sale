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
});
