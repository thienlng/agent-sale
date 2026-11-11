import type { AutonomySettingsResponse, CareSettingsResponse } from '@agent-sales/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { CareSettingsCard } from './care-settings-card';

const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
const perms = vi.hoisted(() => ({ manage: true }));
vi.mock('@/lib/permissions', () => ({
  useCan: (capability: string) => capability !== 'settings.manage' || perms.manage,
}));

const settings: CareSettingsResponse = {
  templates: [
    { key: 'silent', enabled: true, instruction: '', afterSaleDays: 3 },
    { key: 'ready', enabled: true, instruction: 'Nhắc freeship', afterSaleDays: 3 },
    { key: 'after_sale', enabled: true, instruction: '', afterSaleDays: 3 },
  ],
  quietHours: { from: 21, to: 8, timeZone: 'Asia/Ho_Chi_Minh' },
  maxPerConversationPerDay: 2,
  usage: { day: '2026-11-11', used: 7, limit: 100 },
};
const autonomy: AutonomySettingsResponse = {
  actions: [
    {
      action: 'care.send_message',
      level: 'suggest',
      default: 'suggest',
      levels: ['suggest', 'act_and_report', 'auto'],
    },
  ],
};

function routes(): Parameters<typeof stubFetch>[0] {
  return {
    'GET /care/settings': { status: 200, body: settings },
    'GET /brain/autonomy': { status: 200, body: autonomy },
    'PUT /brain/autonomy': {
      status: 200,
      body: { actions: [{ ...autonomy.actions[0], level: 'act_and_report' }] },
    },
    'PUT /care/templates/silent': {
      status: 200,
      body: { key: 'silent', enabled: true, instruction: 'Xưng shop', afterSaleDays: 3 },
    },
    'PUT /care/templates/after_sale': {
      status: 200,
      body: { key: 'after_sale', enabled: true, instruction: '', afterSaleDays: 5 },
    },
  };
}

beforeAll(async () => {
  await loadNamespace('brain');
});
afterEach(() => {
  perms.manage = true;
  vi.unstubAllGlobals();
});

describe('CareSettingsCard', () => {
  it('shows the level, templates, quiet hours, cap and usage, and the Meta rule', async () => {
    vi.stubGlobal('fetch', stubFetch(routes()).fetchStub);
    renderWithProviders(<CareSettingsCard />);
    expect(await screen.findByRole('radio', { name: /Đề xuất/ })).toBeChecked();
    expect(screen.getByText('Hôm nay AI đã soạn 7/100 tin chăm sóc')).toBeInTheDocument();
    expect(screen.getByText('Không nhắn từ 21:00 đến 08:00 (giờ Việt Nam)')).toBeInTheDocument();
    expect(screen.getByText('Tối đa 2 tin trong 24 giờ')).toBeInTheDocument();
    expect(screen.getByText('100 tin chăm sóc')).toBeInTheDocument();
    expect(screen.getByText(/chỉ cho shop nhắn khách trong 24 giờ/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Khách im lặng' })).toBeChecked();
    expect(
      screen.getByLabelText('Dặn AI (không bắt buộc)', { selector: '#care-ready-instruction' }),
    ).toHaveValue('Nhắc freeship');
  });

  it('saves only what changed: the level and the edited templates', async () => {
    const stub = stubFetch(routes());
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithProviders(
      <>
        <CareSettingsCard />
        <Toaster />
      </>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: /Làm rồi báo/ }));
    await user.type(
      screen.getByLabelText('Dặn AI (không bắt buộc)', { selector: '#care-silent-instruction' }),
      'Xưng shop',
    );
    const days = screen.getByLabelText('Nhắc sau');
    await user.clear(days);
    await user.type(days, '5');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(stub.calls.find((c) => c.key === 'PUT /care/templates/after_sale')?.body).toEqual({
        enabled: true,
        instruction: '',
        afterSaleDays: 5,
      }),
    );
    expect(stub.calls.find((c) => c.key === 'PUT /brain/autonomy')?.body).toEqual({
      actions: [{ action: 'care.send_message', level: 'act_and_report' }],
    });
    expect(stub.calls.find((c) => c.key === 'PUT /care/templates/silent')?.body).toEqual({
      enabled: true,
      instruction: 'Xưng shop',
    });
    expect(stub.calls.some((c) => c.key === 'PUT /care/templates/ready')).toBe(false);
    expect(await screen.findByText('Đã lưu cài đặt')).toBeInTheDocument();
  });

  it('refuses an after-sales delay outside 1–30 days', async () => {
    const stub = stubFetch(routes());
    vi.stubGlobal('fetch', stub.fetchStub);
    renderWithProviders(<CareSettingsCard />);
    const user = userEvent.setup();
    const days = await screen.findByLabelText('Nhắc sau');
    await user.clear(days);
    await user.type(days, '45');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('is read-only without settings.manage', async () => {
    perms.manage = false;
    vi.stubGlobal('fetch', stubFetch(routes()).fetchStub);
    renderWithProviders(<CareSettingsCard />);
    expect(await screen.findByRole('radio', { name: /Tự làm/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Sắp chốt' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
    expect(screen.getByText('Chỉ chủ shop và quản trị đổi được cài đặt này.')).toBeInTheDocument();
  });
});
