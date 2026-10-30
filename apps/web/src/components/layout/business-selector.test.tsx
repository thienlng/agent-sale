import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithRouter } from '@/testing/render';

import { BusinessSelector } from './business-selector';

const session = vi.hoisted(() => ({
  value: {
    user: { id: 'u1' },
    workspaceId: 'a',
    memberships: [
      { workspaceId: 'a', workspaceName: 'Ken Shop', role: 'owner' },
      { workspaceId: 'b', workspaceName: 'Spa Lan', role: 'owner' },
    ],
  },
}));
vi.mock('@/lib/session', () => ({ useSession: () => session.value }));
const apiBlob = vi.hoisted(() => vi.fn(async () => new Blob(['png'])));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  apiBlob,
}));
vi.mock('@/hooks/use-business-switch', () => ({
  useBusinessSwitch: () => ({ busy: false, choose: vi.fn() }),
}));

beforeEach(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

// The selector links to the account overview, so it renders inside a router.
function renderSelector() {
  return renderWithRouter(() => (
    <TooltipProvider>
      <SidebarProvider>
        <BusinessSelector
          createBusinessDialog={({ open, onOpenChange }) =>
            open ? (
              <div role="dialog" aria-label="create-dialog">
                <button type="button" onClick={() => onOpenChange(false)}>
                  close-stub
                </button>
              </div>
            ) : null
          }
        />
      </SidebarProvider>
    </TooltipProvider>
  ));
}

describe('BusinessSelector create action', () => {
  it('shows a persistent create action below the list and opens the dialog', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(await screen.findByRole('button', { name: 'Chọn business' }));
    expect(screen.getByRole('button', { name: 'Spa Lan' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: /Tạo business/ });
    expect(create).toBeInTheDocument();
    await user.click(create);
    expect(screen.getByRole('dialog', { name: 'create-dialog' })).toBeInTheDocument();
  });

  it('keeps the create action when the search has no results', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(await screen.findByRole('button', { name: 'Chọn business' }));
    await user.type(screen.getByLabelText('Tìm business'), 'zzz');
    expect(screen.getByText('Không tìm thấy business.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tạo business/ })).toBeInTheDocument();
  });
});

describe('BusinessSelector logo', () => {
  it('shows the current business logo in place of the building icon', async () => {
    session.value.memberships[0] = { ...session.value.memberships[0], logoVersion: 'v1' } as never;
    renderSelector();
    const trigger = await screen.findByRole('button', { name: 'Chọn business' });
    await waitFor(() => expect(trigger.querySelector('img')).not.toBeNull());
    expect(apiBlob).toHaveBeenCalledWith('/workspace/logo', 'a');
  });
});
