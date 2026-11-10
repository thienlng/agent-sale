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
    pageSlot: null,
    sheetAfterPage: false,
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

  it('closes the sheet on the full page and opens it after only when asked', () => {
    const ui = useAssistantUi.getState();
    const slot = document.createElement('div');
    ui.setOpen(true);
    ui.setPageSlot(slot);
    expect(useAssistantUi.getState()).toMatchObject({ pageSlot: slot, open: false });
    // A report notification opened the panel meanwhile: leaving the page keeps the sheet shut.
    ui.setOpen(true);
    ui.setPageSlot(null);
    expect(useAssistantUi.getState()).toMatchObject({ pageSlot: null, open: false });

    ui.setPageSlot(slot);
    ui.toSheet();
    ui.setPageSlot(null);
    expect(useAssistantUi.getState()).toMatchObject({ open: true, sheetAfterPage: false });
  });
});
