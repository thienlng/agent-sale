import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/testing/render';
import { BusinessIndustry } from './business-industry';

const context = vi.hoisted(() => ({ id: 'workspace-hotel' }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => context.id }));
afterEach(() => vi.unstubAllGlobals());

describe('business template summary', () => {
  it('shows the selected business template as read-only text and follows the business query key', async () => {
    context.id = 'workspace-hotel';
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
            name: context.id === 'workspace-hotel' ? 'Hotel business' : 'Fashion business',
            industry: context.id === 'workspace-hotel' ? 'hotel' : 'fashion',
            createdAt: '2026-10-27T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const view = renderWithProviders(<BusinessIndustry />);
    expect(await screen.findByText('Khách sạn / homestay')).toBeInTheDocument();
    expect(screen.getByText('Loại hình')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // The name is edited elsewhere; the summary must not repeat it.
    expect(screen.queryByText('Hotel business')).not.toBeInTheDocument();
    context.id = 'workspace-fashion';
    view.rerender(<BusinessIndustry />);
    expect(await screen.findByText('Thời trang')).toBeInTheDocument();
    expect(screen.queryByText('Khách sạn / homestay')).not.toBeInTheDocument();
    expect(fetchStub.mock.calls).toHaveLength(2);
  });
});
