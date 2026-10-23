import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { LoginForm } from './login-form';

describe('LoginForm', () => {
  it('renders Vietnamese labels from the i18n catalog by default', () => {
    renderWithProviders(<LoginForm />);
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});
