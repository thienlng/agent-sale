import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { settingsFixture } from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { AssistantSettings } from './assistant-settings';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({
  useWorkspaceId: () => '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
}));

beforeAll(() => loadNamespace('assistant'));
afterEach(() => {
  vi.unstubAllGlobals();
  toast.error.mockClear();
});

describe('AssistantSettings', () => {
  it('turns the review off and a toolset off; core and ui stay locked', async () => {
    const routes: Parameters<typeof stubFetch>[0] = {
      'GET /assistant/settings': { status: 200, body: settingsFixture() },
      'PATCH /assistant/settings': {
        status: 200,
        body: settingsFixture({ reviewEnabled: false }),
      },
    };
    const { fetchStub, calls } = stubFetch(routes);
    vi.stubGlobal('fetch', fetchStub);
    const onOpenMemory = vi.fn();
    renderWithProviders(<AssistantSettings onOpenMemory={onOpenMemory} />);
    const user = userEvent.setup();

    const review = await screen.findByRole('switch', {
      name: /Cho trợ lý tự học từ các cuộc trò chuyện/,
    });
    expect(review).toBeChecked();
    expect(screen.getByRole('switch', { name: /Cơ bản/ })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Chỉ dẫn trên màn hình/ })).toBeDisabled();
    expect(screen.getByText('Luôn bật · 14 lần dùng trong 30 ngày')).toBeInTheDocument();
    expect(screen.getByText('21 lần dùng trong 30 ngày')).toBeInTheDocument();

    await user.click(review);
    await waitFor(() => expect(review).not.toBeChecked());
    expect(calls.find((c) => c.key === 'PATCH /assistant/settings')?.body).toEqual({
      reviewEnabled: false,
    });

    routes['PATCH /assistant/settings'] = {
      status: 200,
      body: settingsFixture({ reviewEnabled: false, disabledToolsets: ['routes'] }),
    };
    const lookups = screen.getByRole('switch', { name: /Tra cứu và thao tác dữ liệu/ });
    await user.click(lookups);
    await waitFor(() => expect(lookups).not.toBeChecked());
    expect(calls.filter((c) => c.key === 'PATCH /assistant/settings').at(-1)?.body).toEqual({
      disabledToolsets: ['routes'],
    });

    await user.click(screen.getByRole('button', { name: 'Trợ lý nhớ gì' }));
    expect(onOpenMemory).toHaveBeenCalledOnce();
  });

  it('keeps the switch as it was when the save fails', async () => {
    const { fetchStub } = stubFetch({
      'GET /assistant/settings': { status: 200, body: settingsFixture() },
      'PATCH /assistant/settings': {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom', traceId: 't' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<AssistantSettings onOpenMemory={() => undefined} />);
    const user = userEvent.setup();

    const review = await screen.findByRole('switch', { name: /Cho trợ lý tự học/ });
    await user.click(review);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Không lưu được cài đặt. Thử lại.'),
    );
    expect(review).toBeChecked();
  });
});
