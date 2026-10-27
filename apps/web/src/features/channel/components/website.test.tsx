import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, renderWithRouter, stubFetch } from '@/testing/render';

import { IntegrationsView } from './integrations-view';
import { WebsiteCreateDialog } from './website-create-dialog';
import { WebsiteEmbedCode } from './website-embed-code';
import { WebsiteInstallGuide } from './website-install-guide';
import { WebsitePreview } from './website-preview';
import { WebsiteSettingsPanel } from './website-settings-panel';

vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());

const settings = {
  domains: ['shop.vn'],
  color: '#F97316',
  position: 'right' as const,
  agentName: 'Tư vấn viên',
  avatarUrl: null,
  greeting: 'Chào anh/chị, em có thể hỗ trợ gì ạ?',
  phonePrompt: 'Để lại số điện thoại nhé.',
  phoneChipText: 'Gửi số điện thoại để được gọi lại',
  requirePhoneAfter: 0,
};
const site: ChannelConnectionDto = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e77',
  provider: 'website',
  externalId: 'wk_AbC123xyz',
  name: 'Shop Hoa',
  status: 'connected',
  botId: null,
  expiresAt: null,
  createdAt: '2026-10-23T03:00:00.000Z',
  settings,
};

describe('WebsiteCreateDialog', () => {
  it('rejects a domain with a scheme and path and does not submit', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <WebsiteCreateDialog bots={[]} saving={false} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    await userEvent.type(screen.getByLabelText('Tên website'), 'Shop');
    await userEvent.type(screen.getByLabelText('Tên miền'), 'https://x.vn/a');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo website' }));
    expect(await screen.findByText(/Tên miền không hợp lệ: https:\/\/x\.vn\/a/)).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits normalised domains from a comma list', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <WebsiteCreateDialog bots={[]} saving={false} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    await userEvent.type(screen.getByLabelText('Tên website'), ' Shop ');
    await userEvent.type(screen.getByLabelText('Tên miền'), 'Shop.vn, www.shop.vn');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo website' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Shop', domains: ['shop.vn', 'www.shop.vn'] });
  });
});

describe('WebsiteEmbedCode', () => {
  it('renders the site key in the script tag and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<WebsiteEmbedCode siteKey="wk_AbC123xyz" />);
    expect(screen.getByLabelText('Mã nhúng')).toHaveTextContent(
      /\?key=wk_AbC123xyz" async><\/script>/,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sao chép mã nhúng' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('?key=wk_AbC123xyz'));
    expect(await screen.findByRole('button', { name: 'Đã chép' })).toBeVisible();
  });
});

describe('WebsiteInstallGuide', () => {
  it('lists the platforms and shows the GTM steps', async () => {
    renderWithProviders(<WebsiteInstallGuide />);
    for (const name of ['HTML', 'WordPress', 'LadiPage', 'Haravan', 'Sapo', 'Shopify', 'Wix']) {
      expect(screen.getByRole('tab', { name })).toBeVisible();
    }
    await userEvent.click(screen.getByRole('tab', { name: 'Google Tag Manager' }));
    expect(screen.getByText(/Custom HTML/)).toBeVisible();
  });
});

describe('WebsitePreview', () => {
  it('draws the unsaved colour, name and greeting', () => {
    renderWithProviders(
      <WebsitePreview settings={{ ...settings, color: '#112233', position: 'left' }} />,
    );
    expect(screen.getByTestId('website-preview-header')).toHaveStyle({
      backgroundColor: 'rgb(17, 34, 51)',
    });
    expect(screen.getByText(settings.greeting)).toBeVisible();
    expect(screen.getByTestId('website-preview')).toHaveClass('items-start');
  });
});

describe('WebsiteSettingsPanel', () => {
  it('saves only the changed fields and updates the preview live', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <WebsiteSettingsPanel connection={site} saving={false} onClose={vi.fn()} onSave={onSave} />,
    );
    const color = screen.getByLabelText('Màu chủ đạo');
    await userEvent.clear(color);
    await userEvent.type(color, '#000000');
    expect(screen.getByTestId('website-preview-header')).toHaveStyle({
      backgroundColor: 'rgb(0, 0, 0)',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onSave).toHaveBeenCalledWith({ color: '#000000' });
  });

  it('blocks an invalid value with an inline error', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <WebsiteSettingsPanel connection={site} saving={false} onClose={vi.fn()} onSave={onSave} />,
    );
    const color = screen.getByLabelText('Màu chủ đạo');
    await userEvent.clear(color);
    await userEvent.type(color, 'red');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Giá trị chưa hợp lệ.')).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('IntegrationsView website tab', () => {
  const routes = {
    'GET /channels': { status: 200, body: { data: [site], providers: [] } },
    'GET /bots': { status: 200, body: { data: [] } },
  };
  it('lists the site, toggles it off and saves settings via PATCH /website', async () => {
    const { fetchStub, calls } = stubFetch({
      ...routes,
      [`PATCH /channels/${site.id}/website`]: {
        status: 200,
        body: { ...site, status: 'disabled' },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Website' }));
    const card = (await screen.findByText('Shop Hoa')).closest('li')!;
    expect(within(card).getByText('Đang chạy')).toBeVisible();
    expect(within(card).getByText('Tên miền: shop.vn')).toBeVisible();
    await userEvent.click(within(card).getByRole('switch'));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /channels/${site.id}/website`)?.body).toEqual({
        enabled: false,
      }),
    );
  });

  it('creates a website and then shows its embed code', async () => {
    const created = { ...site, id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e78', name: 'Mới' };
    const { fetchStub, calls } = stubFetch({
      'GET /channels': { status: 200, body: { data: [], providers: [] } },
      'GET /bots': { status: 200, body: { data: [] } },
      'POST /channels/website': { status: 201, body: created },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Website' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm website' }));
    await userEvent.type(screen.getByLabelText('Tên website'), 'Mới');
    await userEvent.type(screen.getByLabelText('Tên miền'), 'shop.vn');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo website' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /channels/website')?.body).toEqual({
        name: 'Mới',
        domains: ['shop.vn'],
      }),
    );
  });
});

describe('IntegrationsView website flows (fix round 1)', () => {
  const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
  it('creating from a bot screen binds the new site to that bot', async () => {
    const created = {
      ...site,
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e79',
      botId: BOT,
      name: 'Mới',
    };
    const { fetchStub, calls } = stubFetch({
      'GET /channels': {
        status: 200,
        body: { data: [{ ...created, name: 'Mới' }], providers: [] },
      },
      'GET /bots': { status: 200, body: { data: [] } },
      'POST /channels/website': { status: 201, body: created },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <IntegrationsView mode={{ kind: 'bot', botId: BOT }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Website' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Thêm website' }));
    await userEvent.type(screen.getByLabelText('Tên website'), 'Mới');
    await userEvent.type(screen.getByLabelText('Tên miền'), 'shop.vn');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo website' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /channels/website')?.body).toEqual({
        name: 'Mới',
        domains: ['shop.vn'],
        botId: BOT,
      }),
    );
    expect(await screen.findByText('Cài đặt chat cho Mới')).toBeVisible();
  });

  it('disconnect asks first and sends {disconnect:true}', async () => {
    const { fetchStub, calls } = stubFetch({
      'GET /channels': { status: 200, body: { data: [site], providers: [] } },
      'GET /bots': { status: 200, body: { data: [] } },
      [`PATCH /channels/${site.id}`]: { status: 200, body: { ...site, status: 'disconnected' } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Website' }));
    await userEvent.click(await screen.findByRole('button', { name: /Xóa kết nối: Shop Hoa/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xóa kết nối' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === `PATCH /channels/${site.id}`)?.body).toEqual({
        disconnect: true,
      }),
    );
  });

  it('shows no toggle for a disconnected site', async () => {
    const { fetchStub } = stubFetch({
      'GET /channels': {
        status: 200,
        body: { data: [{ ...site, status: 'reauth_required' }], providers: [] },
      },
      'GET /bots': { status: 200, body: { data: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(<IntegrationsView mode={{ kind: 'workspace' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Website' }));
    const card = (await screen.findByText('Shop Hoa')).closest('li')!;
    expect(within(card).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(card).getByText('Hết hạn')).toBeVisible();
  });
});
