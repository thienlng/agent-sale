import type { ScheduleDto } from '@agent-sales/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import { proposalFixture } from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { AssistantSchedules } from './assistant-schedules';
import { ScheduleProposalCard } from './schedule-proposal-card';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
vi.mock('@/lib/session', () => ({
  useSession: (): Session => ({
    user: { id: 'u1' } as Session['user'],
    accounts: [{ accountId: ACCOUNT, name: 'Shop An', role: 'owner' }],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Shop An',
        role: 'owner',
        industry: 'retail',
        accountId: ACCOUNT,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  }),
}));

const schedule = (over: Partial<ScheduleDto> = {}): ScheduleDto => ({
  id: '01a19d25-57b8-7082-bbf9-35da4e0c3200',
  name: 'Doanh thu hôm qua',
  businessId: WS,
  template: 'revenue_summary',
  mode: 'report',
  params: { period: 'day', window: 'previous' },
  cadence: { kind: 'daily', at: '08:00' },
  channels: ['in_app', 'email'],
  commentary: false,
  status: 'active',
  pausedReason: null,
  nextRunAt: '2026-11-03T01:00:00.000Z',
  lastRun: null,
  createdBy: 'owner',
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: '2026-11-01T01:00:00.000Z',
  ...over,
});

function stubList(items: ScheduleDto[], used = items.length) {
  const s = stubFetch({
    'GET /assistant/schedules': {
      status: 200,
      body: { items, limit: 10, used, emailAvailable: true },
    },
  });
  vi.stubGlobal('fetch', s.fetchStub);
  return s;
}

beforeAll(async () => {
  Element.prototype.hasPointerCapture ??= () => false;
  await loadNamespace('assistant');
});
beforeEach(() => useAssistantUi.setState({ scheduleDraft: null }));
afterEach(() => vi.unstubAllGlobals());

describe('AssistantSchedules', () => {
  it('lists the schedules with the cadence in words and a paused reason', async () => {
    stubList([
      schedule(),
      schedule({
        id: '01a19d25-57b8-7082-bbf9-35da4e0c3201',
        name: 'Hết hàng',
        template: 'low_stock',
        status: 'paused',
        pausedReason: 'failures',
        params: { threshold: 5 },
      }),
    ]);
    renderWithProviders(<AssistantSchedules />);
    expect(await screen.findByText('Doanh thu hôm qua')).toBeInTheDocument();
    expect(screen.getAllByTestId('schedule-cadence')[0]).toHaveTextContent('Hằng ngày lúc 08:00');
    expect(screen.getByText('Tạm dừng vì lỗi 3 lần liên tiếp')).toBeInTheDocument();
    expect(screen.getByText('Đã dùng 2/10 lịch')).toBeInTheDocument();
  });

  it('disables "Thêm lịch" at 10 of 10', async () => {
    stubList([schedule()], 10);
    renderWithProviders(<AssistantSchedules />);
    expect(await screen.findByRole('button', { name: 'Thêm lịch' })).toBeDisabled();
  });

  it('opens an accepted suggestion as a prefilled editor', async () => {
    stubList([]);
    useAssistantUi.getState().openScheduleEditor({
      name: 'Khách chờ lâu',
      template: 'unanswered_conversations',
      mode: 'alert',
      params: { minutes: 30, minCount: 1 },
      cadence: { kind: 'every', minutes: 60 },
      channels: ['in_app'],
    });
    renderWithProviders(<AssistantSchedules />);
    const form = await screen.findByRole('form', { name: 'Lịch mới' });
    expect(within(form).getByRole('textbox', { name: 'Tên lịch' })).toHaveValue('Khách chờ lâu');
    expect(within(form).getByRole('radio', { name: 'Cảnh báo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(useAssistantUi.getState().scheduleDraft).toBeNull();
  });

  it('asks before deleting', async () => {
    const { calls } = stubList([schedule()]);
    renderWithProviders(<AssistantSchedules />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Xoá' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'Xoá lịch "Doanh thu hôm qua"?',
    );
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
  });
});

describe('ScheduleProposalCard', () => {
  it('shows the cadence in words and the next runs', () => {
    renderWithProviders(
      <ScheduleProposalCard
        proposal={proposalFixture({
          kind: 'schedule',
          routeKey: 'SCHEDULE create',
          summary: 'Gửi doanh thu tuần trước mỗi sáng thứ Hai',
          preview: {
            draft: {
              name: 'Doanh thu tuần trước',
              businessId: WS,
              template: 'revenue_summary',
              mode: 'report',
              params: { period: 'week', window: 'previous' },
              cadence: { kind: 'weekly', days: [1], at: '08:00' },
              channels: ['in_app', 'email'],
              commentary: false,
            },
            nextRuns: [
              '2026-11-09T01:00:00.000Z',
              '2026-11-16T01:00:00.000Z',
              '2026-11-23T01:00:00.000Z',
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('Tạo lịch')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-cadence')).toHaveTextContent('Thứ Hai hằng tuần lúc 08:00');
    expect(within(screen.getByTestId('proposal-next-runs')).getAllByRole('listitem')).toHaveLength(
      3,
    );
    expect(screen.getByText('Trong ứng dụng, Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeEnabled();
  });
});
