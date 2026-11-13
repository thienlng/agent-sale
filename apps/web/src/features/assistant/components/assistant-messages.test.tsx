import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { messageFixture } from '@/testing/assistant-factories';
import { renderWithProviders } from '@/testing/render';

import { AssistantMessages } from './assistant-messages';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => loadNamespace('assistant'));

describe('AssistantMessages charts', () => {
  it('shows the chart of an answer below its text (lazy-loaded)', { timeout: 20_000 }, async () => {
    const answer = messageFixture({
      content: 'Dạ doanh thu tuần này là 350.000 ₫.',
      runId: null,
      uiActions: [
        { type: 'navigate', to: '/app/orders' },
        {
          type: 'chart',
          chart: {
            kind: 'bar',
            title: 'Doanh thu theo ngày',
            x: { key: 'day', label: 'Ngày' },
            series: [{ key: 'revenue', label: 'Doanh thu' }],
            unit: 'vnd',
            rows: [{ day: '2026-11-02', revenue: 350_000 }],
          },
        },
      ],
    });
    renderWithProviders(
      <AssistantMessages
        messages={[answer]}
        loading={false}
        pendingTurn={null}
        unavailable={false}
      />,
    );
    expect(screen.getByText('Dạ doanh thu tuần này là 350.000 ₫.')).toBeInTheDocument();
    expect(
      await screen.findByText('Doanh thu theo ngày', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem bảng' })).toBeInTheDocument();
  });
});

describe('AssistantMessages empty conversation', () => {
  it('offers starter questions that send on click', async () => {
    const onStarter = vi.fn();
    renderWithProviders(
      <AssistantMessages
        messages={[]}
        loading={false}
        pendingTurn={null}
        unavailable={false}
        onStarter={onStarter}
      />,
    );
    expect(
      screen.getByText('Rapiz Agent — trợ lý vận hành cho chủ doanh nghiệp'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Nhóm tính năng của Rapiz Agent' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Quản lý và giám sát bot')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Doanh thu từng shop tháng này so với tháng trước?',
      }),
    );
    expect(onStarter).toHaveBeenCalledWith('Doanh thu từng shop tháng này so với tháng trước?');
  });

  it('disables the starters while a message is on its way', () => {
    renderWithProviders(
      <AssistantMessages messages={[]} loading={false} pendingTurn={null} unavailable={false} />,
    );
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('AssistantMessages busy reply (AS-1)', () => {
  const RUN = '01a1d0f5-0000-7000-8000-000000000001';
  const question = messageFixture({
    id: '01a1d0f5-0000-7000-8000-000000000011',
    role: 'user',
    content: 'doanh thu tuần này',
    runId: RUN,
  });
  const busy = messageFixture({
    id: '01a1d0f5-0000-7000-8000-000000000012',
    content: 'Dạ hệ thống AI đang bận nên em chưa trả lời được câu này.',
    runId: RUN,
    retryable: true,
  });

  it('offers "Thử lại" under the last busy reply and sends the question again', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <AssistantMessages
        messages={[question, busy]}
        loading={false}
        pendingTurn={null}
        unavailable={false}
        onRetry={onRetry}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledWith('doanh thu tuần này');
  });

  it('offers no retry once the conversation moved on, or while a turn runs', () => {
    const later = messageFixture({
      id: '01a1d0f5-0000-7000-8000-000000000013',
      role: 'user',
      content: 'Câu khác',
    });
    const { unmount } = renderWithProviders(
      <AssistantMessages
        messages={[question, busy, later]}
        loading={false}
        pendingTurn={null}
        unavailable={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    unmount();
    renderWithProviders(
      <AssistantMessages
        messages={[question, busy]}
        loading={false}
        pendingTurn="turn-1"
        unavailable={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });
});
