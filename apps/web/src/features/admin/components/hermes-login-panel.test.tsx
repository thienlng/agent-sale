import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { HermesLoginPanel } from './hermes-login-panel';

const id = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10';
const path = `/admin/llm/providers/${id}/hermes-login`;
const pending = {
  state: 'pending',
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-1234',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

afterEach(() => vi.unstubAllGlobals());

function setup(routes: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(routes);
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithProviders(<HermesLoginPanel providerId={id} />);
  return stub;
}

describe('HermesLoginPanel', () => {
  it('disabled: shows a note instead of the sign-in button', async () => {
    setup({ [`GET ${path}`]: { status: 200, body: { state: 'disabled' } } });
    expect(await screen.findByText(/đang tắt trong môi trường này/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng nhập ChatGPT' })).not.toBeInTheDocument();
  });

  it('pending: tells the admin to keep the page open', async () => {
    setup({ [`GET ${path}`]: { status: 200, body: pending } });
    expect(await screen.findByText(/giữ trang này mở/)).toBeInTheDocument();
  });

  it('logout confirmation says the sign-out is local only', async () => {
    setup({ [`GET ${path}`]: { status: 200, body: { state: 'signed_in' } } });
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }));
    expect(await screen.findByText(/chỉ xóa phiên đăng nhập trên máy này/)).toBeInTheDocument();
  });

  it('signed out: explains and starts the device-code login', async () => {
    const { calls } = setup({
      [`GET ${path}`]: { status: 200, body: { state: 'signed_out' } },
      [`POST ${path}`]: { status: 200, body: pending },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập ChatGPT' }));
    expect(await screen.findByText('ABCD-1234')).toBeInTheDocument();
    expect(calls.some((c) => c.key === `POST ${path}`)).toBe(true);
    const link = screen.getByRole('link', { name: /Mở trang đăng nhập OpenAI/ });
    expect(link).toHaveAttribute('href', pending.verificationUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText(/trang sẽ tự cập nhật/)).toBeInTheDocument();
    expect(screen.getByText(/Mã hết hạn sau/)).toBeInTheDocument();
    expect(screen.getByText(/chỉ dùng cho hệ thống này/)).toBeInTheDocument();
  });

  it('pending: shows the code and offers a restart', async () => {
    const { calls } = setup({
      [`GET ${path}`]: { status: 200, body: pending },
      [`POST ${path}`]: { status: 200, body: pending },
    });
    expect(await screen.findByText('ABCD-1234')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hủy và lấy mã mới' }));
    await waitFor(() => expect(calls.some((c) => c.key === `POST ${path}`)).toBe(true));
  });

  it('pending: polls the status every 3 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { calls } = setup({ [`GET ${path}`]: { status: 200, body: pending } });
      await screen.findByText('ABCD-1234');
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(3_100);
      await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    } finally {
      vi.useRealTimers();
    }
  });

  it('signed in: confirms before signing out', async () => {
    const { calls } = setup({
      [`GET ${path}`]: { status: 200, body: { state: 'signed_in' } },
      [`DELETE ${path}`]: { status: 200, body: { state: 'signed_out' } },
    });
    expect(await screen.findByText('Đã đăng nhập ChatGPT')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(calls.some((c) => c.key === `DELETE ${path}`)).toBe(false);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Đăng xuất')!,
    );
    expect(await screen.findByRole('button', { name: 'Đăng nhập ChatGPT' })).toBeInTheDocument();
  });

  it('failed: shows a friendly message for the code and allows retry', async () => {
    setup({
      [`GET ${path}`]: { status: 200, body: { state: 'failed', code: 'device_code_timeout' } },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã đã hết hạn');
    expect(screen.getByRole('button', { name: 'Thử đăng nhập lại' })).toBeInTheDocument();
  });

  it('unreachable: explains how to start the bridge', async () => {
    setup({ [`GET ${path}`]: { status: 200, body: { state: 'unreachable' } } });
    expect(await screen.findByText('Không kết nối được tới Hermes bridge')).toBeInTheDocument();
    expect(screen.getByText(/python bridge.py/)).toBeInTheDocument();
  });
});
