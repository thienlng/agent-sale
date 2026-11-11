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
  const approval = (n: number, template: string, leftMs: number) => ({
    ...item(n, { channel: n % 2 ? 'facebook' : 'instagram' }),
    careMessageId: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a${String(n).padStart(2, '0')}`,
    template,
    text: `Dạ chị ơi, mẫu đầm chị hỏi hôm qua shop vẫn còn size M và L ạ. ${LONG} Chị cần shop giữ hàng không ạ?`,
    // The page hides a draft whose window closed: count from the real clock.
    windowClosesAt: new Date(Date.now() + leftMs).toISOString(),
    createdAt: now,
  });
  return {
    queues: [
      queue('attention', 1),
      queue('unanswered', 3),
      queue('ready', 5),
      queue('price_silent', 7),
      queue('follow_up', 9),
      {
        key: 'approval',
        count: 3,
        items: [
          approval(11, 'silent', 3 * 3_600_000),
          approval(12, 'ready', 50 * 60_000),
          approval(13, 'after_sale', 20 * 3_600_000),
        ],
      },
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

/** `GET /today/ai-done`: two reported sends, one answered. */
export function aiDoneMock(LONG: string, now: string) {
  const sent = (n: number, repliedAt: string | null) => ({
    careMessageId: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9b${String(n).padStart(2, '0')}`,
    conversationId: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e${String(n).padStart(2, '0')}`,
    customerName: `Trần Văn Minh Quang Huy Hoàng ${n}`,
    avatarUrl: null,
    channel: 'facebook',
    template: n % 2 ? 'silent' : 'ready',
    text: `Anh ơi, shop gửi lại báo giá combo ${LONG}`,
    sentAt: now,
    repliedAt,
  });
  return { count: 2, items: [sent(1, now), sent(2, null)] };
}

/** `GET /brain/impact`: large figures, so the strip wraps on a phone. */
export function impactMock(range: string, now: string) {
  return {
    range,
    since: now,
    until: now,
    followUpsSent: 1240,
    repliesReceived: 318,
    ai: { orders: 128, revenue: 184_500_000 },
    aiStaff: { orders: 47, revenue: 96_250_000 },
  };
}

/** `/app/settings/brain`: the Brain card and the care card. */
export function brainSettingsRoute(path: string): unknown {
  if (path === '/brain/settings')
    return { mode: 'auto', idleMinutes: 45, briefingEnabled: true, briefingHour: 7 };
  if (path === '/brain/usage') return { used: 37, limit: 200 };
  if (path === '/brain/autonomy')
    return {
      actions: [
        {
          action: 'care.send_message',
          level: 'suggest',
          default: 'suggest',
          levels: ['suggest', 'act_and_report', 'auto'],
        },
      ],
    };
  if (path === '/care/settings')
    return {
      templates: [
        { key: 'silent', enabled: true, instruction: '', afterSaleDays: 3 },
        {
          key: 'ready',
          enabled: true,
          instruction: 'Xưng “shop”, gọi khách là “chị”. Nhắc freeship cho đơn từ 500k.',
          afterSaleDays: 3,
        },
        { key: 'after_sale', enabled: false, instruction: '', afterSaleDays: 3 },
      ],
      quietHours: { from: 21, to: 8, timeZone: 'Asia/Ho_Chi_Minh' },
      maxPerConversationPerDay: 2,
      usage: { day: '2026-11-11', used: 23, limit: 100 },
    };
  return undefined;
}
