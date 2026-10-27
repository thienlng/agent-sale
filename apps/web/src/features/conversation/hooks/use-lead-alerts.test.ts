import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxConversation } from '../lib/inbox-v2-types';
import { useLeadAlerts } from './use-lead-alerts';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const notify = vi.fn();
beforeEach(() => {
  notify.mockReset();
  class FakeNotification {
    static permission = 'granted';
    constructor(title: string) {
      notify(title);
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
});
afterEach(() => vi.unstubAllGlobals());

const conv = (id: string, capturedAt: string | null) =>
  ({
    id,
    customerId: id,
    customerName: id,
    provider: 'website',
    lead: capturedAt ? { contactId: 'c', phone: '+84912345679', capturedAt, seenAt: null } : null,
  }) as unknown as InboxConversation;

describe('useLeadAlerts', () => {
  it('announces a lead that appears after the first load', () => {
    const { rerender } = renderHook(({ items }) => useLeadAlerts(items, 'all'), {
      initialProps: { items: [conv('a', null)] },
    });
    rerender({ items: [conv('a', '2026-10-27T10:00:00.000Z')] });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not announce old unseen leads that a different filter reveals', () => {
    const { rerender } = renderHook(({ items, key }) => useLeadAlerts(items, key), {
      initialProps: { items: [conv('a', null)] as InboxConversation[] | undefined, key: 'all' },
    });
    // New query: the previous rows are kept as placeholders (undefined), then its own rows arrive.
    rerender({ items: undefined, key: 'unread' });
    rerender({ items: [conv('old', '2026-10-01T10:00:00.000Z')], key: 'unread' });
    expect(notify).not.toHaveBeenCalled();
    rerender({
      items: [conv('old', '2026-10-01T10:00:00.000Z'), conv('new', '2026-10-27T10:00:00.000Z')],
      key: 'unread',
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
