import { screen, waitFor, within } from '@testing-library/react';
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

// The selector links to the account layer, so it renders inside a router.
function renderSelector() {
  return renderWithRouter(() => (
    <TooltipProvider>
      <SidebarProvider>
        <BusinessSelector />
      </SidebarProvider>
    </TooltipProvider>
  ));
}

describe('BusinessSelector search', () => {
  it('filters the businesses and says when none match', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(await screen.findByRole('button', { name: 'Chọn business' }));
    expect(screen.getByRole('button', { name: 'Spa Lan' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tìm business'), 'zzz');
    expect(screen.getByText('Không tìm thấy business.')).toBeInTheDocument();
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

describe('BusinessSelector account actions', () => {
  it('keeps account actions in their own labelled group, apart from the businesses', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(await screen.findByRole('button', { name: 'Chọn business' }));
    expect(screen.getByText('Chuyển sang business khác')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Tài khoản' });
    expect(within(group).getByRole('link', { name: /Quản lý tài khoản/ })).toHaveAttribute(
      'href',
      '/app/overview',
    );
    expect(within(group).getByRole('link', { name: /Tất cả business/ })).toHaveAttribute(
      'href',
      '/app/businesses',
    );
    expect(within(group).queryByRole('button', { name: 'Spa Lan' })).toBeNull();
    // Creating a business lives on the account layer, not in the picker.
    expect(screen.queryByRole('button', { name: /Tạo business/ })).toBeNull();
  });
});
