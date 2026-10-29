import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders } from '@/testing/render';

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

function renderSelector() {
  return renderWithProviders(
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
    </TooltipProvider>,
  );
}

describe('BusinessSelector create action', () => {
  it('shows a persistent create action below the list and opens the dialog', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'Chọn business' }));
    expect(screen.getByRole('button', { name: 'Spa Lan' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: /Tạo business/ });
    expect(create).toBeInTheDocument();
    await user.click(create);
    expect(screen.getByRole('dialog', { name: 'create-dialog' })).toBeInTheDocument();
  });

  it('keeps the create action when the search has no results', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByRole('button', { name: 'Chọn business' }));
    await user.type(screen.getByLabelText('Tìm business'), 'zzz');
    expect(screen.getByText('Không tìm thấy business.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tạo business/ })).toBeInTheDocument();
  });
});

describe('BusinessSelector logo', () => {
  it('shows the logo the route passes in place of the building icon', () => {
    renderWithProviders(
      <TooltipProvider>
        <SidebarProvider>
          <BusinessSelector businessLogo={<img alt="" data-testid="biz-logo" src="blob:x" />} />
        </SidebarProvider>
      </TooltipProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Chọn business' });
    expect(trigger.querySelector('[data-testid="biz-logo"]')).not.toBeNull();
    expect(trigger.querySelector('svg.lucide-building2, svg.lucide-building-2')).toBeNull();
  });
});
