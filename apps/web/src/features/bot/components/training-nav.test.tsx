import type { BotDto } from '@agent-sales/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { TrainingNav } from './training-nav';

// The on/off switch has its own tests; this file covers the menu entries only.
vi.mock('./bot-active-switch', () => ({ BotActiveSwitch: () => null }));

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

  it('toggles the test chat from the menu instead of a floating button', async () => {
    const onTestChat = vi.fn();
    await renderNav({ onTestChat, testChatOpen: true });
    const button = screen.getByRole('button', { name: 'Chat thử' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button);
    expect(onTestChat).toHaveBeenCalledOnce();
  });

  it('has no test chat button when the page does not offer one', async () => {
    await renderNav();
    expect(screen.queryByRole('button', { name: 'Chat thử' })).toBeNull();
  });
});
