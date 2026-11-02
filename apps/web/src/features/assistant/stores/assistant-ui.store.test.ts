import { beforeEach, describe, expect, it } from 'vitest';

import { useAssistantUi } from './assistant-ui.store';

beforeEach(() =>
  useAssistantUi.setState({
    open: false,
    workspaceId: null,
    threadId: null,
    spotlight: null,
    draft: null,
    entityExtras: null,
  }),
);

describe('useAssistantUi', () => {
  it('keeps the thread within one business and drops it, with the spotlight, on a switch', () => {
    const ui = useAssistantUi.getState();
    ui.syncWorkspace('ws-a');
    ui.setThread('thread-a');
    ui.setSpotlight({ target: 'orders.new', hint: 'Ở đây' });

    ui.syncWorkspace('ws-a');
    expect(useAssistantUi.getState()).toMatchObject({ threadId: 'thread-a' });

    ui.syncWorkspace('ws-b');
    expect(useAssistantUi.getState()).toMatchObject({
      workspaceId: 'ws-b',
      threadId: null,
      spotlight: null,
    });
  });

  it('opens with a draft and entity extras, each taken once', () => {
    const ui = useAssistantUi.getState();
    ui.setSpotlight({ target: 'orders.new', hint: 'Ở đây' });
    ui.openWith('Vì sao bot trả lời vậy?', { messageAt: '2026-11-02T08:00:00.000Z' });
    expect(useAssistantUi.getState()).toMatchObject({ open: true, spotlight: null });
    expect(ui.takeDraft()).toBe('Vì sao bot trả lời vậy?');
    expect(ui.takeDraft()).toBeNull();
    expect(ui.takeEntityExtras()).toEqual({ messageAt: '2026-11-02T08:00:00.000Z' });
    expect(ui.takeEntityExtras()).toBeNull();
    ui.openWith('Chào');
    expect(useAssistantUi.getState().entityExtras).toBeNull();
  });
});
