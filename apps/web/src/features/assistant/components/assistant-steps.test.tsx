import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import {
  ASSISTANT_IDS,
  messageFixture,
  runFixture,
  threadFixture,
} from '@/testing/assistant-factories';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { FIRST_RUN_POLL_MS } from '../api/assistant';
import { AssistantMessages } from './assistant-messages';
import { AssistantThreadList } from './assistant-thread-list';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
beforeAll(() => loadNamespace('assistant'));
afterEach(() => vi.unstubAllGlobals());

describe('assistant steps and threads', () => {
  it('shows a technical trace of an answer: run totals, tokens, tool args and result', async () => {
    const { fetchStub, calls } = stubFetch({
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: {
        status: 200,
        body: runFixture({
          steps: [
            {
              idx: 0,
              kind: 'model_call',
              toolName: null,
              ok: true,
              ms: 900,
              errorCode: null,
              detail: {
                tokens: { input: 1200, cached: 800, output: 45 },
                requested: ['session_search'],
              },
            },
            {
              idx: 1,
              kind: 'tool',
              toolName: 'session_search',
              ok: false,
              ms: 45,
              errorCode: 'TIMEOUT',
              detail: { args: '{"query":"khoá học"}', resultChars: 32, result: '{"ok":false}' },
            },
          ],
          debug: {
            tier: 'pro',
            provider: 'openai',
            model: 'gpt-5',
            promptVersion: 'owner-assistant@4',
            inputTokens: 1200,
            cachedTokens: 800,
            outputTokens: 45,
            guardrail: null,
            startedAt: '2026-11-04T01:00:00.000Z',
            finishedAt: '2026-11-04T01:00:02.000Z',
          },
        }),
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithProviders(
      <AssistantMessages
        messages={[messageFixture()]}
        loading={false}
        pendingTurn={null}
        unavailable={false}
      />,
    );
    expect(calls).toHaveLength(0);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Xem các bước' }));

    expect(await screen.findByText('session_search ✕ TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('openai/gpt-5')).toBeInTheDocument();
    expect(screen.getByText('owner-assistant@4')).toBeInTheDocument();
    expect(screen.getByText('2,000 in (800 cached, 1,200 new) · 45 out')).toBeInTheDocument();
    expect(screen.getByText('2,000(800c)→45')).toBeInTheDocument();
    expect(screen.getByText('900ms')).toBeInTheDocument();
    expect(screen.getByText('{"query":"khoá học"}')).toBeInTheDocument();
    expect(screen.getByText('{"ok":false}')).toBeInTheDocument();
  });

  it('polls a live turn only after the send had time to create its run', async () => {
    const { fetchStub, calls } = stubFetch({
      [`GET /assistant/runs/${ASSISTANT_IDS.turn}`]: {
        status: 200,
        body: runFixture({
          steps: [
            {
              idx: 0,
              kind: 'tool',
              toolName: 'tool_search',
              ok: true,
              ms: 12,
              errorCode: null,
              detail: null,
            },
          ],
        }),
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const startedAt = Date.now();
    renderWithProviders(
      <AssistantMessages
        messages={[]}
        loading={false}
        pendingTurn={ASSISTANT_IDS.turn}
        unavailable={false}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, FIRST_RUN_POLL_MS / 2));
    expect(calls).toHaveLength(0);
    await waitFor(() => expect(calls).toHaveLength(1), { timeout: FIRST_RUN_POLL_MS * 2 });
    expect(calls[0]?.key).toBe(`GET /assistant/runs/${ASSISTANT_IDS.turn}`);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(FIRST_RUN_POLL_MS - 20);
    expect(await screen.findByText('tool_search')).toBeInTheDocument();
  });

  it('lists threads pinned first and searches with q after typing stops', async () => {
    const { fetchStub, calls } = stubFetch({
      'GET /assistant/threads': {
        status: 200,
        body: {
          data: [
            threadFixture({ title: 'Hỏi về đơn hàng' }),
            threadFixture({ id: ASSISTANT_IDS.thread2, title: 'Cài đặt bot', pinned: true }),
          ],
        },
      },
      'GET /assistant/threads?q=kho%20h%C3%A0ng': {
        status: 200,
        body: { data: [threadFixture({ title: 'Kiểm kho hàng' })] },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    const onPick = vi.fn();
    renderWithProviders(<AssistantThreadList currentId={null} onPick={onPick} />);

    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Cài đặt bot', 'Hỏi về đơn hàng']);

    const user = userEvent.setup();
    await user.type(
      screen.getByRole('searchbox', { name: 'Tìm trong cuộc trò chuyện' }),
      'kho hàng',
    );
    expect(await screen.findByText('Kiểm kho hàng', {}, { timeout: 2000 })).toBeInTheDocument();
    // Debounced: one search request for the whole phrase, none per keystroke.
    await waitFor(() =>
      expect(calls.map((c) => c.key).filter((k) => k.includes('?q='))).toEqual([
        'GET /assistant/threads?q=kho%20h%C3%A0ng',
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'Kiểm kho hàng' }));
    expect(onPick).toHaveBeenCalledWith(ASSISTANT_IDS.thread);
  });
});
