import type { BotDto } from '@agent-sales/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { TrainingNav } from './training-nav';

// The on/off switch has its own tests; this file covers the menu entries only.
vi.mock('./bot-active-switch', () => ({ BotActiveSwitch: () => null }));
const can = vi.hoisted(() => ({ manage: true }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.manage }));
const admin = vi.hoisted(() => ({ value: false }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { isPlatformAdmin: admin.value } }),
}));

const BOT = { id: 'b1', name: 'Shop bot' } as BotDto;

async function renderNav(props: Partial<Parameters<typeof TrainingNav>[0]> = {}) {
  const root = createRootRoute({ component: () => <TrainingNav bot={BOT} {...props} /> });
  const catchAll = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([catchAll]),
    history: createMemoryHistory({ initialEntries: ['/app/bots/b1'] }),
  });
  renderWithProviders(<RouterProvider router={router} />);
  // Desktop list and mobile strip share the label; both are in the DOM.
  return screen.findAllByRole('navigation', { name: 'Menu huấn luyện' });
}

describe('TrainingNav', () => {
  it('shows API actions only to members who manage bots', async () => {
    for (const nav of await renderNav()) {
      expect(within(nav).getByRole('link', { name: 'Hành động API' })).toHaveAttribute(
        'href',
        '/app/bots/b1/actions',
      );
    }
  });

  it('hides API actions from members who cannot manage bots', async () => {
    can.manage = false;
    try {
      for (const nav of await renderNav()) {
        expect(within(nav).queryByRole('link', { name: 'Hành động API' })).toBeNull();
      }
    } finally {
      can.manage = true;
    }
  });

  it('has no image library entry in either menu', async () => {
    for (const nav of await renderNav()) {
      expect(within(nav).queryByRole('link', { name: 'Thư viện ảnh' })).toBeNull();
      for (const link of within(nav).getAllByRole('link')) {
        expect(link.getAttribute('href')).not.toMatch(/\/media$/);
      }
    }
  });

  it('labels the bot integrations page as channel integrations', async () => {
    for (const nav of await renderNav()) {
      expect(within(nav).getByRole('link', { name: 'Tích hợp kênh' })).toHaveAttribute(
        'href',
        '/app/bots/b1/integrations',
      );
    }
  });

  it('has no test chat button: the chat reopens from its own collapsed rail', async () => {
    await renderNav();
    expect(screen.queryByRole('button', { name: /Chat thử/ })).toBeNull();
  });

  it('names the catalog "Dịch vụ" for an education or spa bot (MS-24, LM-3)', async () => {
    for (const nav of await renderNav({ bot: { ...BOT, industry: 'spa' } as BotDto })) {
      expect(within(nav).getByRole('link', { name: 'Dịch vụ' })).toHaveAttribute(
        'href',
        '/app/bots/b1/products',
      );
    }
  });

  it('shows the development tools to the platform team only (MS-30)', async () => {
    for (const nav of await renderNav()) {
      expect(within(nav).queryByRole('link', { name: 'Tool Ads Facebook' })).toBeNull();
    }
  });

  it('keeps the development tools for a platform admin', async () => {
    admin.value = true;
    try {
      for (const nav of await renderNav()) {
        expect(within(nav).getByRole('link', { name: 'Tool Ads Facebook' })).toBeVisible();
      }
    } finally {
      admin.value = false;
    }
  });
});
