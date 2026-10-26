import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, stubFetch } from '@/testing/render';
import { FanpagePanel } from './fanpage-panel';
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());
const id = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const path = `/channels/${id}/fanpage`;
const settings = {
  publicReplies: false,
  privateReplies: false,
  hideComments: false,
  hideKeywords: [],
  excludedPostIds: [],
};
const routes = {
  'GET /channels': {
    status: 200,
    body: {
      data: [
        {
          id,
          provider: 'facebook',
          externalId: '123',
          name: 'Test Page',
          status: 'connected',
          botId: null,
          expiresAt: null,
          createdAt: '2026-10-25T00:00:00Z',
        },
      ],
      providers: [],
    },
  },
  [`GET ${path}/settings`]: { status: 200, body: settings },
  [`GET ${path}/posts`]: {
    status: 200,
    body: {
      data: [
        {
          id: '123_10',
          text: 'Blue shirt 250k',
          permalink: 'https://www.facebook.com/123_10',
          media: [],
          fetchedAt: '2026-10-25T00:00:00Z',
        },
      ],
    },
  },
  [`GET ${path}/comments`]: { status: 200, body: { data: [] } },
  [`PATCH ${path}/settings`]: { status: 200, body: settings },
};
describe('Fanpage automation controls', () => {
  it('saves independent private-reply settings and per-post exclusions', async () => {
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<FanpagePanel />);
    await screen.findByText('Blue shirt 250k');
    await userEvent.click(
      screen.getByRole('switch', { name: 'Tự động nhắn tin riêng cho người bình luận' }),
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Bật tự động cho bài viết 123_10' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Lưu thiết lập và lựa chọn bài viết' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH ${path}/settings`)?.body).toEqual({
        ...settings,
        privateReplies: true,
        excludedPostIds: ['123_10'],
      }),
    );
  });
  it('shows post permission failures while keeping settings available', async () => {
    const { fetchStub } = stubFetch({
      ...routes,
      [`GET ${path}/posts`]: {
        status: 503,
        body: { error: { code: 'UNAVAILABLE', message: 'Reconnect' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<FanpagePanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được bài viết');
    expect(
      screen.getByRole('switch', { name: 'Tự động trả lời bình luận công khai' }),
    ).toBeEnabled();
  });
});
