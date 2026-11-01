import { screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { connection, list } from './fixtures';
import { IntegrationsHub } from './integrations-hub';

beforeAll(() => loadNamespace('integration'));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  can.value = true;
});

function setup(body: unknown) {
  const { fetchStub } = stubFetch({ 'GET /integrations': { status: 200, body } });
  vi.stubGlobal('fetch', fetchStub);
  renderWithRouter(() => <IntegrationsHub />);
}

describe('IntegrationsHub', () => {
  it('offers to connect KiotViet and marks the others coming soon', async () => {
    setup(list(null));
    expect(
      await screen.findByRole('heading', { name: 'Tích hợp PMS', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Kết nối KiotViet' })).toHaveAttribute(
      'href',
      '/app/integrations/kiotviet',
    );
    for (const name of ['Sapo', 'Haravan', 'Pancake POS'])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getAllByText('Sắp có')).toHaveLength(3);
  });

  it('shows the connection status and a manage link once connected', async () => {
    setup(list(connection({ status: 'syncing' })));
    expect(await screen.findByRole('link', { name: 'Quản lý KiotViet' })).toBeInTheDocument();
    expect(screen.getByText('Đang đồng bộ')).toBeInTheDocument();
  });

  it('has no connect button for members who cannot change settings', async () => {
    can.value = false;
    setup(list(null));
    expect(await screen.findByText('Chưa kết nối')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kết nối KiotViet' })).toBeNull();
  });
});
