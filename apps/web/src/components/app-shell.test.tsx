import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '@/testing/render';

import { AppShell } from './app-shell';

vi.mock('@/lib/session', () => ({ useSession: () => null }));
vi.mock('./layout/app-sidebar', () => ({ AppSidebar: () => <nav>sidebar</nav> }));
vi.mock('./layout/account-menu', () => ({ AccountMenu: () => <button>account</button> }));

describe('AppShell', () => {
  it('renders the header actions before the account menu', async () => {
    renderWithRouter(() => (
      <AppShell headerActions={<button>bell</button>}>
        <p>page</p>
      </AppShell>
    ));
    const bell = await screen.findByRole('button', { name: 'bell' });
    const account = screen.getByRole('button', { name: 'account' });
    expect(bell.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('page')).toBeInTheDocument();
  });
});
