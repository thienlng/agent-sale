import type { AssistantThreadDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { groupThreads } from './assistant-thread-list';

const NOW = new Date(2026, 10, 12, 15, 0).getTime();
const at = (daysAgo: number, hour = 10) => new Date(2026, 10, 12 - daysAgo, hour, 0).toISOString();

function thread(id: string, lastMessageAt: string, pinned = false): AssistantThreadDto {
  return {
    id,
    title: id,
    pinned,
    archived: false,
    businessId: null,
    lastMessageAt,
    createdAt: lastMessageAt,
  };
}

describe('groupThreads', () => {
  it('puts pinned threads first, then by day bucket, keeping the order inside a group', () => {
    const groups = groupThreads(
      [
        thread('pin-old', at(90), true),
        thread('today-a', at(0, 14)),
        thread('today-b', at(0, 1)),
        thread('yesterday', at(1)),
        thread('week', at(5)),
        thread('month', at(20)),
        thread('older', at(45)),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.group, g.threads.map((t) => t.id)])).toEqual([
      ['pinned', ['pin-old']],
      ['today', ['today-a', 'today-b']],
      ['yesterday', ['yesterday']],
      ['week', ['week']],
      ['month', ['month']],
      ['older', ['older']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(groupThreads([thread('a', at(3))], NOW).map((g) => g.group)).toEqual(['week']);
    expect(groupThreads([], NOW)).toEqual([]);
  });
});
