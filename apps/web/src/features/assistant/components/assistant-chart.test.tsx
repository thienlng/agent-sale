import type { AssistantChart as AssistantChartSpec } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { formatDay, formatVnd } from '@/lib/format';
import { renderWithProviders } from '@/testing/render';

import AssistantChart from './assistant-chart';

beforeAll(() => loadNamespace('assistant'));

const daily: AssistantChartSpec = {
  kind: 'bar',
  title: 'Doanh thu 3 ngày',
  x: { key: 'day', label: 'Ngày' },
  series: [{ key: 'revenue', label: 'Doanh thu' }],
  unit: 'vnd',
  rows: [
    { day: '2026-10-31', revenue: 100_000 },
    { day: '2026-11-01', revenue: 1_250_000 },
    { day: '2026-11-02', revenue: null },
  ],
};

describe('AssistantChart', () => {
  it('renders the title and, after the toggle, a table row per data row with VND', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<AssistantChart chart={daily} />);
    expect(screen.getByText('Doanh thu 3 ngày')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Xem bảng' }));
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + daily.rows.length);
    expect(within(rows[0]!).getByText('Doanh thu')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(formatDay('2026-10-31'))).toBeInTheDocument();
    // Intl puts a no-break space before ₫, so compare the cell text as is.
    expect(rows[1]!.textContent).toContain(formatVnd(100_000));
    expect(rows[2]!.textContent).toContain(formatVnd(1_250_000));
    expect(within(rows[3]!).getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="chart"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Xem biểu đồ' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull();
  });

  it('renders a pie chart and a line chart', () => {
    const pie: AssistantChartSpec = {
      kind: 'pie',
      title: 'Khách mới theo nguồn',
      x: { key: 'source', label: 'Nguồn' },
      series: [{ key: 'n', label: 'Khách' }],
      unit: 'count',
      rows: [
        { source: 'Facebook', n: 12 },
        { source: 'Zalo', n: 5 },
      ],
    };
    const a = renderWithProviders(<AssistantChart chart={pie} />);
    expect(screen.getByText('Khách mới theo nguồn')).toBeInTheDocument();
    expect(a.container.querySelector('[data-slot="chart"]')).not.toBeNull();
    a.unmount();

    const line = renderWithProviders(
      <AssistantChart chart={{ ...daily, kind: 'line', title: 'Theo ngày' }} />,
    );
    expect(screen.getByText('Theo ngày')).toBeInTheDocument();
    expect(line.container.querySelector('[data-slot="chart"]')).not.toBeNull();
  });

  it('says there is nothing to chart when the rows are empty', () => {
    renderWithProviders(<AssistantChart chart={{ ...daily, rows: [] }} />);
    expect(screen.getByText('Không có dữ liệu để vẽ biểu đồ.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xem bảng' })).toBeNull();
  });
});
