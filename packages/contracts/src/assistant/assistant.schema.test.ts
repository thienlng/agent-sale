import { describe, expect, it } from 'vitest';

import { assistantRoutes } from './assistant.routes.js';
import {
  AssistantMessageDto,
  AssistantUiAction,
  SendAssistantMessageRequest,
  UpdateAssistantThreadRequest,
} from './assistant.schema.js';

const TURN = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';

describe('AssistantUiAction', () => {
  it('accepts an in-app navigate and a spotlight', () => {
    expect(AssistantUiAction.safeParse({ type: 'navigate', to: '/app/bots' }).success).toBe(true);
    expect(
      AssistantUiAction.safeParse({ type: 'spotlight', target: 'bot.save', hint: 'Bấm Lưu' })
        .success,
    ).toBe(true);
  });

  it('rejects navigating outside the app', () => {
    expect(AssistantUiAction.safeParse({ type: 'navigate', to: 'https://evil.test' }).success).toBe(
      false,
    );
  });
});

describe('UpdateAssistantThreadRequest', () => {
  it('rejects an empty update', () => {
    expect(UpdateAssistantThreadRequest.safeParse({}).success).toBe(false);
  });

  it('accepts a partial update', () => {
    expect(UpdateAssistantThreadRequest.parse({ pinned: true })).toEqual({ pinned: true });
  });
});

describe('SendAssistantMessageRequest', () => {
  it('trims the text', () => {
    expect(SendAssistantMessageRequest.parse({ turnId: TURN, text: '  hello  ' }).text).toBe(
      'hello',
    );
  });

  it('rejects whitespace-only text', () => {
    expect(SendAssistantMessageRequest.safeParse({ turnId: TURN, text: '   ' }).success).toBe(
      false,
    );
  });
});

describe('AssistantMessageDto', () => {
  it('never carries tool rows', () => {
    const msg = {
      id: TURN,
      seq: 1,
      role: 'tool',
      content: '{}',
      uiActions: [],
      runId: null,
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    expect(AssistantMessageDto.safeParse(msg).success).toBe(false);
    expect(AssistantMessageDto.safeParse({ ...msg, role: 'event' }).success).toBe(true);
  });
});

describe('assistantRoutes', () => {
  it('declares the six workspace-scoped assistant routes', () => {
    expect(assistantRoutes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'get /assistant/threads',
      'post /assistant/threads',
      'patch /assistant/threads/{threadId}',
      'get /assistant/threads/{threadId}/messages',
      'post /assistant/threads/{threadId}/messages',
      'get /assistant/runs/{runId}',
    ]);
    for (const r of assistantRoutes) {
      expect(r).toMatchObject({ tag: 'assistant', auth: true, workspaceScoped: true });
    }
  });
});
