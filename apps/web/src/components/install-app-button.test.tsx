import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { InstallAppButton } from './install-app-button';

describe('InstallAppButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('on an iPhone shows a labelled button that opens the home-screen steps', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1',
    });
    renderWithProviders(<InstallAppButton />);
    // Phones get the short label next to the arrow, wider screens the full one.
    expect(screen.getByText('Cài app')).toBeInTheDocument();
    expect(screen.getByText('Cài ứng dụng')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('renders nothing where the browser offers no install', () => {
    renderWithProviders(<InstallAppButton />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
