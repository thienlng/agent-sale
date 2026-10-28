import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/testing/render';
import { BusinessIndustry } from './business-industry';

const context = vi.hoisted(() => ({ id: 'workspace-hotel' }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => context.id }));
afterEach(() => vi.unstubAllGlobals());

describe('business industry settings', () => {
  it('shows the selected business industry read-only and changes with the business query key', async () => {
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
    await screen.findByText('Hotel business');
    expect(screen.getByLabelText('Lĩnh vực kinh doanh')).toHaveValue('Khách sạn / homestay');
    expect(screen.getByLabelText('Lĩnh vực kinh doanh')).toHaveAttribute('readonly');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    context.id = 'workspace-fashion';
    view.rerender(<BusinessIndustry />);
    await screen.findByText('Fashion business');
    expect(screen.getByLabelText('Lĩnh vực kinh doanh')).toHaveValue('Thời trang');
    expect(screen.queryByText('Hotel business')).not.toBeInTheDocument();
    expect(fetchStub.mock.calls).toHaveLength(2);
  });
});
