import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubFetch } from '@/testing/render';

import { DataDeletionStatus } from './data-deletion-status';

const CODE = 'ABCDEF0123456789ABCDEF01';
afterEach(() => vi.unstubAllGlobals());

describe('DataDeletionStatus', () => {
  it('shows a completed request with its code and what was removed', async () => {
    const { fetchStub, calls } = stubFetch({
      [`GET /meta/data-deletion/${CODE}`]: {
        status: 200,
        body: {
          confirmationCode: CODE,
          status: 'completed',
          requestedAt: '2026-11-12T01:00:00.000Z',
          completedAt: '2026-11-12T01:01:00.000Z',
          connectionsRemoved: 2,
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<DataDeletionStatus code={CODE} />);
    expect(await screen.findByText('Đã hoàn tất')).toBeVisible();
    expect(screen.getByText(CODE)).toBeVisible();
    expect(screen.getByText(/Đã ngắt kết nối 2 Trang/)).toBeVisible();
    // A public page: no workspace header is sent.
    expect(
      calls[0]?.headers['X-Workspace-Id'] ?? calls[0]?.headers['x-workspace-id'],
    ).toBeUndefined();
  });

  it('says so for an unknown code, and without a code asks nothing', async () => {
    const { fetchStub, calls } = stubFetch({
      [`GET /meta/data-deletion/${CODE}`]: {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'x' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<DataDeletionStatus code={CODE} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy yêu cầu');
    const { unmount } = renderWithProviders(<DataDeletionStatus code={undefined} />);
    expect(calls).toHaveLength(1);
    unmount();
  });
});
