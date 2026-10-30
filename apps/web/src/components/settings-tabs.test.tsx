import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithRouter } from '@/testing/render';

import { SettingsTabs } from './settings-tabs';

describe('SettingsTabs', () => {
  it('renders links in a labelled nav that never scrolls vertically', async () => {
    renderWithRouter(() => (
      <SettingsTabs
        label="Cài đặt"
        tabs={[
          { to: '/a', label: 'Một' },
          { to: '/b', label: 'Hai' },
        ]}
      />
    ));
    const nav = await screen.findByRole('navigation', { name: 'Cài đặt' });
    expect(screen.getByRole('link', { name: 'Một' })).toHaveAttribute('href', '/a');
    expect(screen.getByRole('link', { name: 'Hai' })).toBeInTheDocument();
    expect(nav).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
    for (const link of screen.getAllByRole('link')) expect(link.className).not.toMatch(/-mb-px/);
  });
});
