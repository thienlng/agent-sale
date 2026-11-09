import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { LoginLayout } from './login-layout';

describe('LoginLayout', () => {
  it('shows the selected conversation without resetting the login fields', async () => {
    renderWithProviders(
      <LoginLayout>
        <input aria-label="Email" />
      </LoginLayout>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'visitor@example.test');
    const delivery = screen.getByRole('button', { name: /Đơn của mình đến đâu rồi/ });
    await userEvent.click(delivery);
    expect(delivery).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Bàn giao cùng tóm tắt hội thoại')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('visitor@example.test');
  });
});
