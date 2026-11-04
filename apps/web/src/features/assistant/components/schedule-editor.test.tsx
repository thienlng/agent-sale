import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import type { Session } from '@/lib/session';
import { renderWithProviders, stubFetch } from '@/testing/render';

import {
  defaultTemplate,
  intervalsFor,
  modesFor,
  ScheduleEditor,
  templatesFor,
} from './schedule-editor';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const business = vi.hoisted(() => ({ industry: 'retail' }));
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
        industry: business.industry,
        accountId: ACCOUNT,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  }),
}));

beforeAll(async () => {
  // Radix Select asks for pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  await loadNamespace('assistant');
});
afterEach(() => {
  vi.unstubAllGlobals();
  business.industry = 'retail';
});

function renderEditor(props: Partial<Parameters<typeof ScheduleEditor>[0]> = {}) {
  const onDone = vi.fn();
  renderWithProviders(<ScheduleEditor emailAvailable onDone={onDone} {...props} />);
  return { onDone, user: userEvent.setup() };
}

const modeGroup = () => screen.getByRole('radiogroup', { name: 'Kiểu' });

describe('ScheduleEditor', () => {
  it('offers the alert mode only for templates that can alert', async () => {
    expect(modesFor('revenue_summary')).toEqual(['report']);
    expect(modesFor('low_stock')).toEqual(['report', 'alert']);
    const { user } = renderEditor();
    expect(
      within(modeGroup())
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['Báo cáo định kỳ']);
    await user.click(screen.getByRole('combobox', { name: 'Nội dung' }));
    await user.click(await screen.findByRole('option', { name: 'Sắp hết hàng' }));
    expect(
      within(modeGroup())
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['Báo cáo định kỳ', 'Cảnh báo']);
  });

  it('offers new requests only to a business whose bot records requests (T-187)', async () => {
    for (const industry of ['education', 'spa', 'saas']) {
      expect(templatesFor(industry)).toContain('new_requests');
    }
    expect(templatesFor('retail')).not.toContain('new_requests');
    expect(templatesFor('retail', 'new_requests')).toContain('new_requests');
    expect(modesFor('new_requests')).toEqual(['report', 'alert']);
    const { user } = renderEditor();
    await user.click(screen.getByRole('combobox', { name: 'Nội dung' }));
    expect(await screen.findByRole('option', { name: 'Khách hàng mới' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Yêu cầu mới' })).not.toBeInTheDocument();
  });

  it('starts a training centre or spa on new requests, without order or stock reports', async () => {
    for (const industry of ['education', 'spa']) {
      expect(templatesFor(industry)).toEqual([
        'unanswered_conversations',
        'new_customers',
        'new_requests',
      ]);
      expect(defaultTemplate(industry)).toBe('new_requests');
      expect(templatesFor(industry, 'new_orders')).toContain('new_orders');
    }
    expect(templatesFor('saas')).toContain('revenue_summary');
    expect(defaultTemplate('retail')).toBe('revenue_summary');
    business.industry = 'education';
    const { user } = renderEditor();
    expect(screen.getByRole('combobox', { name: 'Nội dung' })).toHaveTextContent('Yêu cầu mới');
    await user.click(screen.getByRole('combobox', { name: 'Nội dung' }));
    expect(await screen.findByRole('option', { name: 'Khách hàng mới' })).toBeInTheDocument();
    for (const order of ['Doanh thu', 'Đơn hàng mới', 'Sắp hết hàng'])
      expect(screen.queryByRole('option', { name: new RegExp(order) })).not.toBeInTheDocument();
  });

  it('asks a new requests alert for its minimum count', () => {
    renderEditor({
      draft: { template: 'new_requests', mode: 'alert', cadence: { kind: 'every', minutes: 30 } },
    });
    expect(screen.getByRole('combobox', { name: 'Nội dung' })).toHaveTextContent('Yêu cầu mới');
    expect(screen.getByRole('spinbutton', { name: 'Số lượng tối thiểu' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Khoảng thời gian' })).not.toBeInTheDocument();
  });

  it('limits the interval options by mode', async () => {
    expect(intervalsFor('alert')).toEqual([15, 30, 60, 120, 180, 240, 360, 720]);
    expect(intervalsFor('report')[0]).toBe(60);
    const { user } = renderEditor({
      draft: { template: 'new_orders', mode: 'alert', cadence: { kind: 'every', minutes: 30 } },
    });
    // An alert runs on "Lặp lại" only.
    expect(screen.getByRole('radio', { name: 'Hằng ngày' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Mỗi' }));
    expect(await screen.findByRole('option', { name: '15 phút' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Báo cáo định kỳ' }));
    await user.click(screen.getByRole('radio', { name: 'Lặp lại' }));
    await user.click(screen.getByRole('combobox', { name: 'Mỗi' }));
    expect(await screen.findByRole('option', { name: '1 giờ' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '15 phút' })).not.toBeInTheDocument();
  });

  it('disables email with the reason when it cannot be sent', () => {
    renderEditor({ emailAvailable: false });
    expect(screen.getByRole('checkbox', { name: 'Email' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Trong ứng dụng' })).toBeDisabled();
    expect(screen.getByText(/Chưa gửi được email/)).toBeInTheDocument();
  });

  it('shows the preview of a valid draft', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /assistant/schedules/preview': {
        status: 200,
        body: {
          title: 'Doanh thu hôm qua · Shop An',
          body: 'Doanh số: 1.200.000 ₫',
          nextRuns: [],
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const { user } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'Xem thử' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nhập tên lịch');
    await user.type(screen.getByRole('textbox', { name: 'Tên lịch' }), 'Doanh thu hôm qua');
    await user.click(screen.getByRole('button', { name: 'Xem thử' }));
    const card = await screen.findByTestId('schedule-preview');
    expect(card).toHaveTextContent('Doanh thu hôm qua · Shop An');
    expect(card).toHaveTextContent('Doanh số: 1.200.000 ₫');
    expect(calls[0]?.body).toMatchObject({
      name: 'Doanh thu hôm qua',
      businessId: WS,
      template: 'revenue_summary',
      mode: 'report',
      params: { period: 'day', window: 'previous' },
      cadence: { kind: 'daily', at: '08:00' },
      channels: ['in_app'],
    });
  });

  it('maps a server error code to words', async () => {
    const { fetchStub } = stubFetch({
      'POST /assistant/schedules': {
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'x',
            details: { reason: 'schedule_limit' },
          },
        },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const { user, onDone } = renderEditor({ draft: { name: 'Đơn mới' } });
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Đã đủ 10 lịch'));
    expect(onDone).not.toHaveBeenCalled();
  });
});
