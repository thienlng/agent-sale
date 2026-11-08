import type { DataExportDto } from '@agent-sales/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Route as SettingsRoute } from '@/routes/app/settings';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { DataExportPage, formatBytes } from './data-export-page';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  can.value = true;
});

const ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b02';

function exportItem(overrides: Partial<DataExportDto> = {}): DataExportDto {
  return {
    id: ID,
    status: 'ready',
    includeMedia: false,
    sizeBytes: 3 * 1024 * 1024,
    errorCode: null,
    requestedByName: 'Lan Nguyễn',
    createdAt: '2026-11-08T03:00:00.000Z',
    finishedAt: '2026-11-08T03:02:00.000Z',
    expiresAt: '2026-11-15T03:02:00.000Z',
    ...overrides,
  };
}

function setup(
  list: { data: DataExportDto[]; usedToday?: number },
  extra: Record<string, { status: number; body?: unknown }> = {},
) {
  const stub = stubFetch({
    'GET /data-exports': {
      status: 200,
      body: { data: list.data, usedToday: list.usedToday ?? 0, dailyLimit: 3 },
    },
    ...extra,
  });
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => <DataExportPage />);
  return stub.calls;
}

describe('DataExportPage', () => {
  it('shows the empty state and the remaining exports for today', async () => {
    setup({ data: [], usedToday: 1 });
    expect(await screen.findByText('Chưa có lần xuất nào.')).toBeInTheDocument();
    expect(screen.getByText('Còn 2 lượt hôm nay')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Kèm ảnh và tệp/ })).not.toBeChecked();
  });

  it('starts an export with pictures when asked', async () => {
    const calls = setup(
      { data: [] },
      { 'POST /data-exports': { status: 201, body: exportItem({ status: 'queued' }) } },
    );
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Xuất toàn bộ dữ liệu' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: /Kèm ảnh và tệp/ }));
    await user.click(button);
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /data-exports')?.body).toEqual({
        includeMedia: true,
      }),
    );
  });

  it('downloads a ready export through a one-time link', async () => {
    const url = '/api/v1/data-exports/download/abc';
    const calls = setup(
      { data: [exportItem()] },
      {
        [`POST /data-exports/${ID}/link`]: {
          status: 200,
          body: { url, expiresAt: '2026-11-08T03:07:00.000Z' },
        },
      },
    );
    const opened: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      opened.push(this.getAttribute('href') ?? '');
    });
    const user = userEvent.setup();
    expect(await screen.findByText('Sẵn sàng')).toBeInTheDocument();
    expect(screen.getByText(/Lan Nguyễn · Chỉ dữ liệu · 3 MB · Hết hạn/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tải về' }));
    await waitFor(() => expect(opened).toEqual([url]));
    expect(calls.some((c) => c.key === `POST /data-exports/${ID}/link`)).toBe(true);
  });

  it('blocks a new export while one is running', async () => {
    setup({ data: [exportItem({ status: 'running', sizeBytes: null, expiresAt: null })] });
    expect(await screen.findByText('Đang tạo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất toàn bộ dữ liệu' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Tải về' })).toBeNull();
  });

  it('blocks a new export at the daily limit', async () => {
    setup({ data: [exportItem()], usedToday: 3 });
    expect(
      await screen.findByText('Đã dùng hết 3 lượt xuất hôm nay. Thử lại vào ngày mai.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xuất toàn bộ dữ liệu' })).toBeDisabled();
  });

  it('is closed to members without data.export', async () => {
    can.value = false;
    setup({ data: [] });
    expect(
      await screen.findByText('Chỉ chủ doanh nghiệp hoặc quản trị viên mới xuất được dữ liệu.'),
    ).toBeInTheDocument();
  });
});

describe('settings tabs', () => {
  const Layout = SettingsRoute.options.component as ComponentType;

  it('shows the data tab to owners and admins only', async () => {
    renderWithRouter(() => <Layout />);
    expect(await screen.findByRole('link', { name: 'Dữ liệu' })).toBeInTheDocument();
  });

  it('hides the data tab without the capability', async () => {
    can.value = false;
    renderWithRouter(() => <Layout />);
    expect(await screen.findByRole('link', { name: 'Hồ sơ business' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dữ liệu' })).toBeNull();
  });
});

describe('formatBytes', () => {
  it('uses binary steps', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
  });
});
