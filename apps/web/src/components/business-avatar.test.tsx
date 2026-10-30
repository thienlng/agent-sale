import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { BusinessAvatar } from './business-avatar';

const WS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';

describe('BusinessAvatar', () => {
  it('asks for no picture when the business has no logo', () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<BusinessAvatar workspaceId={WS} logoVersion={null} />);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('draws the picked icon, and the building for an unknown one', () => {
    const { container, rerender } = renderWithProviders(
      <BusinessAvatar workspaceId={WS} logoVersion={null} icon="store" />,
    );
    expect(container.querySelector('svg')).toHaveClass('lucide-store');
    rerender(<BusinessAvatar workspaceId={WS} logoVersion={null} icon="rocket" />);
    expect(container.querySelector('svg')).toHaveClass('lucide-building-2');
  });

  it("reads the logo with that business's own scope and shows it", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 });
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:logo' }));
    const { container } = renderWithProviders(
      <BusinessAvatar workspaceId={WS} logoVersion="abc123" />,
    );
    await vi.waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:logo');
    expect(calls[0]?.url).toBe('/api/v1/workspace/logo');
    expect(calls[0]?.headers['X-Workspace-Id']).toBe(WS);
    expect(screen.queryByRole('img')).toBeNull(); // decorative: the name is next to it
  });
});
