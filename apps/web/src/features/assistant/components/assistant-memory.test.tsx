import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { memoryFixture } from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { AssistantMemory } from './assistant-memory';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({
  useWorkspaceId: () => '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
}));

beforeAll(() => loadNamespace('assistant'));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.success.mockClear();
  toast.error.mockClear();
});

const BUSINESS_STORE = 'business:3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const forgetKey = `DELETE /assistant/memory/${encodeURIComponent(BUSINESS_STORE)}/entries/e2`;

describe('AssistantMemory', () => {
  it('lists every store with its use, and forgets an entry only after a confirm', async () => {
    const memory = memoryFixture();
    const remaining = memoryFixture({
      stores: memory.stores.map((s) =>
        s.store === BUSINESS_STORE ? { ...s, used: 0, entries: [] } : s,
      ),
    });
    const { fetchStub, calls } = stubFetch({
      'GET /assistant/memory': { status: 200, body: memory },
      [forgetKey]: { status: 200, body: remaining },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantMemory />);
    const user = userEvent.setup();

    const shop = await screen.findByRole('region', { name: 'Shop An' });
    expect(screen.getByRole('region', { name: 'Về anh/chị' })).toHaveTextContent(
      'Thích trả lời ngắn gọn.',
    );
    expect(screen.getByRole('region', { name: 'Ghi chú chung' })).toHaveTextContent('Chưa nhớ gì.');
    expect(within(shop).getByText('30/1000 ký tự')).toBeInTheDocument();

    // The first press only asks; keeping it sends nothing.
    await user.click(within(shop).getByRole('button', { name: 'Quên mục này' }));
    await user.click(within(shop).getByRole('button', { name: 'Giữ lại' }));
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);

    await user.click(within(shop).getByRole('button', { name: 'Quên mục này' }));
    await user.click(within(shop).getByRole('button', { name: 'Quên' }));

    await waitFor(() => expect(within(shop).getByText('Chưa nhớ gì.')).toBeInTheDocument());
    expect(within(shop).queryByText('Giao hàng trong ngày ở Hà Nội.')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.key === forgetKey)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Đã quên mục này.');
  });

  it('marks an entry waiting for approval with its origin and approves it', async () => {
    const pendingEntry = (pending: boolean) =>
      memoryFixture({
        stores: memoryFixture().stores.map((s) =>
          s.store === BUSINESS_STORE
            ? {
                ...s,
                entries: s.entries.map((e) => ({ ...e, origin: 'review' as const, pending })),
              }
            : s,
        ),
      });
    const approveKey = `POST /assistant/memory/${encodeURIComponent(BUSINESS_STORE)}/entries/e2/approve`;
    const { fetchStub, calls } = stubFetch({
      'GET /assistant/memory': { status: 200, body: pendingEntry(true) },
      [approveKey]: { status: 200, body: pendingEntry(false) },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantMemory />);
    const user = userEvent.setup();

    const shop = await screen.findByRole('region', { name: 'Shop An' });
    expect(within(shop).getByText('Chờ anh/chị duyệt')).toBeInTheDocument();
    expect(within(shop).getByText('Học được sau cuộc trò chuyện')).toBeInTheDocument();
    // An approved entry has no badge and no approve button.
    const profile = screen.getByRole('region', { name: 'Về anh/chị' });
    expect(within(profile).queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(within(profile).getByText('Anh/chị tự thêm')).toBeInTheDocument();

    await user.click(within(shop).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() =>
      expect(within(shop).queryByText('Chờ anh/chị duyệt')).not.toBeInTheDocument(),
    );
    expect(within(shop).queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.key === approveKey)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Đã duyệt. Trợ lý sẽ dùng mục này.');
  });

  it('keeps the entry and says so when the delete fails', async () => {
    const { fetchStub } = stubFetch({
      'GET /assistant/memory': { status: 200, body: memoryFixture() },
      [forgetKey]: {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom', traceId: 't' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantMemory />);
    const user = userEvent.setup();

    const shop = await screen.findByRole('region', { name: 'Shop An' });
    await user.click(within(shop).getByRole('button', { name: 'Quên mục này' }));
    await user.click(within(shop).getByRole('button', { name: 'Quên' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Không xoá được. Thử lại.'));
    expect(within(shop).getByText('Giao hàng trong ngày ở Hà Nội.')).toBeInTheDocument();
  });
});
