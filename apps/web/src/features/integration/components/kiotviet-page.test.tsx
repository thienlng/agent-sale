import { screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { connection, list } from './fixtures';
import { KiotVietPage } from './kiotviet-page';

beforeAll(() => loadNamespace('integration'));
const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  can.value = true;
});

function setup(body: unknown) {
  const { fetchStub } = stubFetch({
    'GET /integrations': { status: 200, body },
    'GET /integrations/kiotviet/log': { status: 200, body: { entries: [] } },
  });
  vi.stubGlobal('fetch', fetchStub);
  renderWithRouter(() => <KiotVietPage />);
}

describe('KiotVietPage', () => {
  it('shows the wizard until connected', async () => {
    setup(list(null));
    expect(await screen.findByText('Bước 1/3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kết nối KiotViet', level: 1 })).toBeInTheDocument();
  });

  it('shows the connection view when connected, also after a disconnected row', async () => {
    setup(list(connection()));
    expect(await screen.findByRole('heading', { name: 'shopabc' })).toBeInTheDocument();
    expect(screen.queryByText('Bước 1/3')).toBeNull();
  });

  it('treats a disconnected connection as not connected', async () => {
    setup(list(connection({ status: 'disconnected' })));
    expect(await screen.findByText('Bước 1/3')).toBeInTheDocument();
  });

  it('never shows the wizard to members who cannot change settings', async () => {
    can.value = false;
    setup(list(null));
    expect(
      await screen.findByText(
        'Doanh nghiệp chưa kết nối KiotViet. Chủ cửa hàng hoặc quản trị viên có thể kết nối.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Bước 1/3')).toBeNull();
  });
});
