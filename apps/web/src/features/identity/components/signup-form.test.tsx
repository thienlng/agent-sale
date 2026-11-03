import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '@/testing/render';

import { SignupForm } from './signup-form';

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('SignupForm', () => {
  it('does not sign up before a code was sent to the email', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    });
    renderWithRouter(() => <SignupForm onSuccess={() => {}} />);
    await userEvent.type(await screen.findByLabelText('Họ và tên'), 'Lan');
    await userEvent.type(screen.getByLabelText('Email'), 'lan@shop.vn');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'a-strong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Gửi mã');
    expect(calls.filter((u) => u.endsWith('/auth/signup'))).toEqual([]);
  });

  it('sends the code, then signs up with it', async () => {
    const bodies: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(url), 'http://x').pathname.replace('/api/v1', '');
      if (init?.body) bodies[path] = JSON.parse(String(init.body));
      if (path === '/auth/signup/code') return new Response(null, { status: 204 });
      if (path === '/auth/signup')
        return json(400, {
          error: { code: 'VALIDATION_FAILED', message: 'bad', details: { reason: 'code_expired' } },
        });
      return json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } });
    });
    const onSuccess = vi.fn();
    renderWithRouter(() => <SignupForm onSuccess={onSuccess} />);
    await userEvent.type(await screen.findByLabelText('Họ và tên'), 'Lan');
    await userEvent.type(screen.getByLabelText('Email'), 'Lan@Shop.vn');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi mã' }));
    expect(await screen.findByRole('status')).toHaveTextContent('lan@shop.vn');
    expect(bodies['/auth/signup/code']).toEqual({ email: 'lan@shop.vn', name: 'Lan' });
    expect(screen.getByRole('button', { name: /Gửi lại mã sau/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Mã xác minh'), '123456');
    await userEvent.type(screen.getByLabelText('Mật khẩu'), 'a-strong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã đã hết hạn');
    expect(bodies['/auth/signup']).toEqual({
      name: 'Lan',
      email: 'lan@shop.vn',
      password: 'a-strong-password',
      code: '123456',
      client: 'web',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
