import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders } from '@/testing/render';

import { ActionAccess } from './action-access';

beforeAll(() => loadNamespace('action'));

const can = vi.hoisted(() => ({ manage: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.manage }));

describe('ActionAccess', () => {
  it('renders the page for members who manage bots', () => {
    renderWithProviders(<ActionAccess>page</ActionAccess>);
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it('shows a no-permission note instead of the page (and its requests) to everyone else', () => {
    can.manage = false;
    renderWithProviders(<ActionAccess>page</ActionAccess>);
    expect(screen.queryByText('page')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ chủ sở hữu và quản trị viên');
  });
});
