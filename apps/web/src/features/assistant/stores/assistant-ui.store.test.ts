import { beforeEach, describe, expect, it } from 'vitest';

import { useAssistantUi } from './assistant-ui.store';

beforeEach(() =>
  useAssistantUi.setState({ open: false, workspaceId: null, threadId: null, spotlight: null }),
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
});
