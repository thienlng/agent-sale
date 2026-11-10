import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { LoginLayout } from './login-layout';

describe('LoginLayout', () => {
  it('presents example enquiries alongside the form', () => {
    renderWithProviders(
      <LoginLayout>
        <input aria-label="Email" />
      </LoginLayout>,
    );
    const poster = screen.getByRole('complementary');
    expect(within(poster).getAllByRole('listitem')).toHaveLength(9);
    expect(within(poster).getByRole('heading').closest('.sr-only')).toBeNull();
    expect(within(poster).getByText('Shop còn mẫu này không?').closest('.sr-only')).toBeNull();
    expect(within(poster).getByText('Shop còn mẫu này không?')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  });
});
