import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssistantRequest } from '@/lib/assistant-context';
import type { Session } from '@/lib/session';
import { renderWithProviders } from '@/testing/render';

import { AssistantAskButton } from './assistant-ask-button';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const state = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'billing' }));
vi.mock('@/lib/session', () => ({
  useSession: (): Session => ({
    user: { id: 'u1' } as Session['user'],
    accounts: [{ accountId: ACCOUNT, name: 'Shop An', role: state.role }],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Shop An',
        role: 'owner',
        industry: 'retail',
        accountId: ACCOUNT,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  }),
}));

beforeEach(() => {
  useAssistantRequest.setState({ request: null });
});

describe('AssistantAskButton', () => {
  it('asks the assistant the fixed text for the account owner', async () => {
    state.role = 'owner';
    renderWithProviders(<AssistantAskButton text="Điền mẫu giúp mình" />);
    await userEvent.click(screen.getByRole('button', { name: 'Nhờ trợ lý điền mẫu' }));
    expect(useAssistantRequest.getState().request).toMatchObject({ text: 'Điền mẫu giúp mình' });
  });

  it('uses the given label', () => {
    state.role = 'owner';
    renderWithProviders(<AssistantAskButton text="x" label="Soạn FAQ mẫu" />);
    expect(screen.getByRole('button', { name: 'Soạn FAQ mẫu' })).toBeInTheDocument();
  });

  it('renders nothing for anyone but the account owner', () => {
    state.role = 'billing';
    renderWithProviders(<AssistantAskButton text="x" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
