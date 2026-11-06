import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '@/testing/render';

import type { GallerySearch } from '../lib/business-gallery';
import { BusinessGallery } from './business-gallery';

const choose = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/session', () => ({
  useSession: () => ({
    user: { id: 'u1' },
    workspaceId: null,
    accounts: [{ accountId: 'own', name: 'Ken Shop', role: 'owner' }],
    memberships: [
      {
        workspaceId: 'a',
        workspaceName: 'Ken Shop',
        role: 'owner',
        industry: 'retail',
        accountId: 'own',
        accountName: 'Ken Shop',
        createdAt: '2026-10-01T00:00:00Z',
      },
      {
        workspaceId: 'b',
        workspaceName: 'Spa Lan',
        role: 'sales',
        industry: 'spa',
        accountId: 'other',
        accountName: 'Rapiz HQ',
        createdAt: '2026-11-01T00:00:00Z',
      },
    ],
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<object>()),
  apiBlob: vi.fn(async () => new Blob(['png'])),
}));
vi.mock('@/hooks/use-business-switch', () => ({
  useBusinessSwitch: () => ({ busy: false, choose }),
}));

function renderGallery(search: GallerySearch, onSearch = vi.fn()) {
  renderWithRouter(() => <BusinessGallery search={search} onSearch={onSearch} />);
  return onSearch;
}

describe('BusinessGallery', () => {
  it('shows every business as a card, newest first, and opens one', async () => {
    const user = userEvent.setup();
    renderGallery({});
    const cards = await screen.findAllByRole('button', { name: /^Mở business/ });
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Mở business Spa Lan',
      'Mở business Ken Shop',
    ]);
    expect(within(cards[0]!).getByText('Spa / làm đẹp')).toBeInTheDocument();
    await user.click(cards[1]!);
    expect(choose).toHaveBeenCalledWith('a');
  });

  it('names the account only on businesses joined from someone else', async () => {
    renderGallery({});
    const spa = await screen.findByRole('button', { name: 'Mở business Spa Lan' });
    const ken = screen.getByRole('button', { name: 'Mở business Ken Shop' });
    expect(within(spa).getByText('Thuộc tài khoản Rapiz HQ')).toBeInTheDocument();
    expect(within(ken).queryByText(/Thuộc tài khoản/)).toBeNull();
  });

  it('applies the filters it is given and reports name searches', async () => {
    const user = userEvent.setup();
    const onSearch = renderGallery({ industry: 'retail' });
    expect(await screen.findByRole('button', { name: 'Mở business Ken Shop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở business Spa Lan' })).toBeNull();
    await user.type(screen.getByLabelText('Tìm theo tên business'), 'k');
    expect(onSearch).toHaveBeenLastCalledWith({ industry: 'retail', q: 'k' });
    await user.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(onSearch).toHaveBeenLastCalledWith({});
  });

  it('says so when no business matches', async () => {
    renderGallery({ q: 'zzz' });
    expect(await screen.findByText('Không tìm thấy business.')).toBeInTheDocument();
  });
});
