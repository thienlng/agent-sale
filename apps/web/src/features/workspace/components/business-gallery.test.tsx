import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetPreferences } from '@/lib/preferences/preferences';
import { storageKey } from '@/lib/preferences/registry';

import { renderWithRouter } from '@/testing/render';

import type { GallerySearch } from '../lib/business-gallery';
import { BusinessGallery } from './business-gallery';

const choose = vi.hoisted(() => vi.fn(async () => true));
const loading = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/session', () => ({
  useSession: () =>
    loading.value
      ? null
      : {
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
        },
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

afterEach(() => {
  loading.value = false;
  resetPreferences(['business_view']);
  localStorage.clear();
  choose.mockClear();
});

describe('BusinessGallery', () => {
  it('lists every business as a row by default, newest first, and opens one', async () => {
    const user = userEvent.setup();
    renderGallery({});
    expect(await screen.findByRole('radio', { name: 'Danh sách' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('list')).toHaveAttribute('data-view', 'list');
    const rows = screen.getAllByRole('button', { name: /^Mở business/ });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Mở business Spa Lan',
      'Mở business Ken Shop',
    ]);
    expect(within(rows[0]!).getByText('Spa / làm đẹp')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/^Tạo ngày/)).toBeInTheDocument();
    await user.click(rows[1]!);
    expect(choose).toHaveBeenCalledWith('a');
  });

  it('switches to the card grid, remembers the choice and still opens a business', async () => {
    const user = userEvent.setup();
    renderGallery({});
    await user.click(await screen.findByRole('radio', { name: 'Lưới' }));
    expect(screen.getByRole('list')).toHaveAttribute('data-view', 'grid');
    expect(localStorage.getItem(storageKey('business_view'))).toBe('grid');
    cleanup();

    renderGallery({});
    expect(await screen.findByRole('radio', { name: 'Lưới' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('list')).toHaveAttribute('data-view', 'grid');
    const cards = screen.getAllByRole('button', { name: /^Mở business/ });
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Mở business Spa Lan',
      'Mở business Ken Shop',
    ]);
    expect(within(cards[0]!).getByText('Spa / làm đẹp')).toBeInTheDocument();
    await user.click(cards[1]!);
    expect(choose).toHaveBeenCalledWith('a');
  });

  it('shows skeleton rows while the session loads', async () => {
    loading.value = true;
    renderGallery({});
    expect(
      await screen.findByRole('status', { name: 'Đang tải danh sách business…' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Mở business/ })).toBeNull();
  });

  it('names the account only on businesses joined from someone else', async () => {
    renderGallery({});
    const spa = await screen.findByRole('button', { name: 'Mở business Spa Lan' });
    const ken = screen.getByRole('button', { name: 'Mở business Ken Shop' });
    expect(within(spa).getByText('Thuộc tài khoản Rapiz HQ')).toBeInTheDocument();
    expect(within(ken).queryByText(/Thuộc tài khoản/)).toBeNull();
  });

  it.each(['list', 'grid'] as const)('applies the filters in the %s view', async (view) => {
    const user = userEvent.setup();
    renderGallery({ industry: 'spa' });
    await user.click(
      await screen.findByRole('radio', { name: view === 'list' ? 'Danh sách' : 'Lưới' }),
    );
    expect(screen.getByRole('list')).toHaveAttribute('data-view', view);
    expect(screen.getByRole('button', { name: 'Mở business Spa Lan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mở business Ken Shop' })).toBeNull();
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
