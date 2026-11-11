/** `GET /today` with every queue filled with long names and reasons. */
export function todayMock(LONG: string, user: { id: string; name: string }, now: string) {
  const item = (n: number, over: Record<string, unknown> = {}) => ({
    conversationId: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e${String(n).padStart(2, '0')}`,
    contactId: null,
    customerName: `Nguyễn Thị Thanh Hương Lan Anh Phương Thảo ${n}`,
    avatarUrl: null,
    channel: 'facebook',
    reason: `${LONG} — khách hỏi đổi size và giao lại trong ngày`,
    stage: 'ready',
    mood: 'complaint',
    at: now,
    assigneeId: user.id,
    assigneeName: user.name,
    stageLocked: n % 2 === 0,
    ...over,
  });
  const queue = (key: string, start: number) => ({
    key,
    count: 23,
    items: [item(start), item(start + 1, { channel: 'instagram', reason: '' })],
  });
  return {
    queues: [
      queue('attention', 1),
      queue('unanswered', 3),
      queue('ready', 5),
      queue('price_silent', 7),
      queue('follow_up', 9),
      {
        key: 'tasks',
        count: 1,
        items: [
          {
            id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9ef1',
            title: `Gọi lại cho khách về đơn hàng ${LONG}`,
            note: null,
            dueAt: now,
            assigneeUserId: user.id,
            assigneeName: user.name,
            status: 'open',
            contactId: null,
            conversationId: null,
            subjectType: null,
            subjectId: null,
            source: 'today',
            createdAt: now,
            doneAt: null,
            version: 1,
          },
        ],
      },
    ],
    usage: { used: 200, limit: 200 },
    mode: 'manual',
    generatedAt: now,
  };
}
