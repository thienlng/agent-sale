import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { AuthLayout } from './auth-layout';

describe('AuthLayout', () => {
  it('links the logo back to the marketing site', () => {
    renderWithProviders(
      <AuthLayout>
        <p>form</p>
      </AuthLayout>,
    );
    expect(screen.getByRole('link', { name: 'Trang chủ Rapiz' })).toHaveAttribute(
      'href',
      'http://localhost:4321/',
    );
  });
});
