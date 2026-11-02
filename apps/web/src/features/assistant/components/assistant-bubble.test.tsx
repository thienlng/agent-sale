import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/lib/session';
import { renderWithRouter } from '@/testing/render';

import { AssistantBubble } from './assistant-bubble';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const OTHER_ACCOUNT = '7a1e5d4c-2b3f-4e6a-8d9c-0f1e2d3c4b5a';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';

const state = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock('@/lib/session', () => ({ useSession: () => state.session }));

function sessionWith(role: 'owner' | 'billing', workspaceAccount: string): Session {
  return {
    user: { id: 'u1', email: 'a@b.c', name: 'An', isPlatformAdmin: false } as Session['user'],
    accounts: [{ accountId: ACCOUNT, name: 'Shop An', role }],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Shop An',
        role: 'owner',
        industry: 'retail',
        accountId: workspaceAccount,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  };
}

function renderPage() {
  renderWithRouter(() => (
    <>
      <p>page</p>
      <AssistantBubble />
    </>
  ));
}

describe('AssistantBubble launcher', () => {
  beforeEach(() => {
    state.session = null;
  });

  it('shows the launcher to an owner of the account that owns the business', async () => {
    state.session = sessionWith('owner', ACCOUNT);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' })).toBeInTheDocument();
  });

  it('hides the launcher from a billing member of the account', async () => {
    state.session = sessionWith('billing', ACCOUNT);
    renderPage();
    await screen.findByText('page');
    expect(screen.queryByRole('button', { name: 'Hỏi Thỏ Rapiz' })).not.toBeInTheDocument();
  });

  it('hides the launcher when the business belongs to another account', async () => {
    state.session = sessionWith('owner', OTHER_ACCOUNT);
    renderPage();
    await screen.findByText('page');
    expect(screen.queryByRole('button', { name: 'Hỏi Thỏ Rapiz' })).not.toBeInTheDocument();
  });
});
