import type { AssistantProposalDto } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import {
  ASSISTANT_IDS,
  importBatchFixture,
  importProposalFixture,
} from '@/testing/assistant-factories';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { AssistantProposal } from './assistant-proposals';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({
  useWorkspaceId: () => '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
}));
vi.mock('@/lib/session', () => ({ useSession: () => null }));

beforeAll(() => loadNamespace('assistant'));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.error.mockClear();
});

const BATCH_URL = `GET /assistant/imports/${ASSISTANT_IDS.batch}`;

function render(proposal: AssistantProposalDto) {
  return renderWithRouter(() => (
    <ol>
      <AssistantProposal proposal={proposal} />
    </ol>
  ));
}

describe('ImportProposalCard', () => {
  it('shows the counts, the table on demand and the skipped rows with their reasons', async () => {
    const { fetchStub } = stubFetch({ [BATCH_URL]: { status: 200, body: importBatchFixture() } });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    render(importProposalFixture());

    expect(await screen.findByText('Tạo 2 sản phẩm từ hang.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/2 sản phẩm · 2 biến thể/)).toBeInTheDocument();
    expect(screen.getByText(/1 dòng lỗi sẽ bị bỏ qua/)).toBeInTheDocument();
    expect(screen.queryByText(/ẩn với bot/)).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Xem bảng' }));
    const table = screen.getByRole('table', { name: 'Các sản phẩm sẽ được tạo' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(table).getByText('Áo thun')).toBeInTheDocument();
    expect(within(table).getByText('Mũ lưỡi trai')).toBeInTheDocument();
    expect(within(table).queryByText('Quần jean')).not.toBeInTheDocument();
    expect(within(table).getByText('Mã được tạo tự động')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Bỏ qua (1)' }));
    expect(screen.getByText('Dòng 3')).toBeInTheDocument();
    expect(screen.getByText(/Quần jean: Thiếu giá/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
  });

  it('says photo products stay hidden from the bot', async () => {
    const { fetchStub } = stubFetch({ [BATCH_URL]: { status: 200, body: importBatchFixture() } });
    vi.stubGlobal('fetch', fetchStub);
    const proposal = importProposalFixture();
    render({
      ...proposal,
      preview: { ...(proposal.preview as object), visibleToBotDefault: false },
    });
    expect(await screen.findByText(/ẩn với bot/)).toBeInTheDocument();
  });

  it('blocks Áp dụng while the batch drafts are not the ones the proposal pinned', async () => {
    // The cached batch is from a newer preview than this proposal.
    const { fetchStub, calls } = stubFetch({
      [BATCH_URL]: { status: 200, body: importBatchFixture({ draftsHash: 'newer' }) },
    });
    vi.stubGlobal('fetch', fetchStub);
    render(importProposalFixture());

    expect(
      await screen.findByText(
        'Bản xem trước đã thay đổi sau đề nghị này. Hãy nhờ trợ lý đề nghị lại.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeDisabled();
    // It reads the batch again, in case only the cache was old.
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.key === BATCH_URL).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('approves, then shows the report with links to the created products', async () => {
    const done = importBatchFixture({
      results: {
        r1: { status: 'created', productId: ASSISTANT_IDS.product },
        r3: { status: 'failed', errorCode: 'exists_code' },
      },
    });
    const { fetchStub, calls } = stubFetch({
      [BATCH_URL]: { status: 200, body: done },
      [`POST /assistant/proposals/${ASSISTANT_IDS.proposal}/approve`]: {
        status: 200,
        body: importProposalFixture({ status: 'done' }),
      },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
        status: 200,
        body: { items: [importProposalFixture({ status: 'done' })] },
      },
      [`GET /assistant/threads/${ASSISTANT_IDS.thread}/messages`]: {
        status: 200,
        body: { data: [] },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const user = userEvent.setup();
    const pending = render(importProposalFixture());
    await user.click(await screen.findByRole('button', { name: 'Áp dụng' }));
    await vi.waitFor(() => expect(calls.some((c) => c.key.endsWith('/approve'))).toBe(true));
    pending.unmount();

    // The card of a decided import reads the batch again and shows the report.
    render(importProposalFixture({ status: 'done' }));
    expect(await screen.findByText('Đã tạo 1 · Lỗi 1 · Chưa chạy 0')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Mở Áo thun' });
    expect(link).toHaveAttribute('href', `/app/products/${ASSISTANT_IDS.product}`);
    expect(screen.getByText(/Mũ lưỡi trai: Mã đã có trong shop/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).not.toBeInTheDocument();
  });
});
