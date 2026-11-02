import { screen } from '@testing-library/react';
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
