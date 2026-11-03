import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestAssistantOpen } from '@/lib/assistant-context';
import type { Session } from '@/lib/session';
import { threadFixture } from '@/testing/assistant-factories';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';

import { AssistantBubble } from './assistant-bubble';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const OTHER_ACCOUNT = '7a1e5d4c-2b3f-4e6a-8d9c-0f1e2d3c4b5a';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';

const state = vi.hoisted(() => ({ session: null as Session | null }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/session', () => ({ useSession: () => state.session }));

function sessionWith(role: 'owner' | 'billing', workspaceAccount: string): Session {
  return {
    user: { id: 'u1', email: 'a@b.c', name: 'An', isPlatformAdmin: false } as Session['user'],
    accounts: [{ accountId: ACCOUNT, name: 'Shop An', role }],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Shop An',
        role: 'owner',
        industry: 'retail',
        accountId: workspaceAccount,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  };
}

function renderPage() {
  renderWithRouter(() => (
    <>
      <p>page</p>
      <AssistantBubble />
    </>
  ));
}

describe('AssistantBubble launcher', () => {
  beforeEach(() => {
    state.session = null;
  });

  it('shows the launcher to an owner of the account that owns the business', async () => {
    state.session = sessionWith('owner', ACCOUNT);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' })).toBeInTheDocument();
  });

  it('hides the launcher from a billing member of the account', async () => {
    state.session = sessionWith('billing', ACCOUNT);
    renderPage();
    await screen.findByText('page');
    expect(screen.queryByRole('button', { name: 'Hỏi Thỏ Rapiz' })).not.toBeInTheDocument();
  });

  it('hides the launcher when the business belongs to another account', async () => {
    state.session = sessionWith('owner', OTHER_ACCOUNT);
    renderPage();
    await screen.findByText('page');
    expect(screen.queryByRole('button', { name: 'Hỏi Thỏ Rapiz' })).not.toBeInTheDocument();
  });
});

describe('AssistantBubble placement', () => {
  afterEach(() => vi.restoreAllMocks());

  async function renderWith(rect: Partial<DOMRect>) {
    state.session = sessionWith('owner', ACCOUNT);
    useAssistantUi.setState({ open: false, workspaceId: null, threadId: null, spotlight: null });
    renderWithRouter(() => (
      <>
        <form data-assistant-avoid data-testid="composer">
          <button type="submit">Gửi</button>
        </form>
        <AssistantBubble />
      </>
    ));
    const composer = await screen.findByTestId('composer');
    const full = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, ...rect };
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue(full as DOMRect);
    // The page laid out: the launcher measures again.
    act(() => void window.dispatchEvent(new Event('resize')));
  }

  it('moves the launcher above a marked control it would cover (Chat thử Gửi)', async () => {
    const vh = window.innerHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    await renderWith({
      left: vw - 380,
      right: vw,
      top: vh - 60,
      bottom: vh,
      width: 380,
      height: 60,
    });
    const launcher = await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' });
    // Above the composer's top edge, with a gap.
    await waitFor(() => expect(launcher.style.bottom).toBe('68px'));
  });

  it('stays at rest when the marked control is elsewhere', async () => {
    const vh = window.innerHeight;
    await renderWith({ left: 0, right: 300, top: vh - 60, bottom: vh, width: 300, height: 60 });
    const launcher = await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(launcher.style.bottom).toBe('16px');
  });

  it('reserves room under a padded page so its last button stays reachable', async () => {
    state.session = sessionWith('owner', ACCOUNT);
    renderPage();
    await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' });
    const spacer = document.querySelector('[data-assistant-spacer]');
    expect(spacer).toHaveClass('h-20');
    expect(spacer).toHaveAttribute('aria-hidden');
  });
});

describe('AssistantBubble open requests', () => {
  const RUN = '01a19d25-57b8-7082-bbf9-35da4e0c3001';
  afterEach(() => vi.unstubAllGlobals());

  it("opens a report run's thread when the bell asks for it", async () => {
    state.session = sessionWith('owner', ACCOUNT);
    useAssistantUi.setState({ open: false, workspaceId: null, threadId: null, spotlight: null });
    const thread = threadFixture();
    const { fetchStub, calls } = stubFetch({
      [`POST /assistant/schedule-runs/${RUN}/thread`]: { status: 200, body: thread },
      [`GET /assistant/threads/${thread.id}/messages`]: { status: 200, body: { data: [] } },
      [`GET /assistant/threads/${thread.id}/proposals`]: { status: 200, body: { items: [] } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderPage();
    await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' });
    act(() => requestAssistantOpen({ reportRunId: RUN }));
    await waitFor(() =>
      expect(useAssistantUi.getState()).toMatchObject({ open: true, threadId: thread.id }),
    );
    expect(calls.map((c) => c.key)).toContain(`POST /assistant/schedule-runs/${RUN}/thread`);
  });

  it('says the schedule was deleted and shows the report text when the run is gone (404)', async () => {
    state.session = sessionWith('owner', ACCOUNT);
    useAssistantUi.setState({ open: false, workspaceId: null, threadId: null, spotlight: null });
    toast.error.mockClear();
    const { fetchStub } = stubFetch({
      [`POST /assistant/schedule-runs/${RUN}/thread`]: {
        status: 404,
        body: { error: { code: 'not_found', message: 'Not found' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderPage();
    await screen.findByRole('button', { name: 'Hỏi Thỏ Rapiz' });
    act(() =>
      requestAssistantOpen({
        reportRunId: RUN,
        title: 'Báo cáo sáng',
        body: 'Doanh thu: 1.000.000 ₫',
      }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Lịch này đã bị xoá',
        expect.objectContaining({ description: 'Doanh thu: 1.000.000 ₫' }),
      ),
    );
    // The panel does not open on whatever view it had before.
    expect(useAssistantUi.getState()).toMatchObject({ open: false, threadId: null });
  });
});
