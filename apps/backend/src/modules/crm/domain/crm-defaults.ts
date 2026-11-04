/**
 * Built-in options every workspace starts with (docs/reference/preny-dashboard-spec.md
 * §3.3, §3.4, §3.7). Seeded on first use, identified by `key`, editable and archivable
 * like any other option. Names are Vietnamese product content.
 */
export const DEFAULT_SOURCES = [
  { key: 'facebook', name: 'Facebook', color: '#1877f2' },
  { key: 'zalo', name: 'Zalo', color: '#0068ff' },
  { key: 'instagram', name: 'Instagram', color: '#d62976' },
  { key: 'tiktok', name: 'TikTok', color: '#111827' },
  { key: 'website', name: 'Website', color: '#0ea5e9' },
  { key: 'hotline', name: 'Hotline', color: '#16a34a' },
  { key: 'lazada', name: 'Lazada', color: '#f97316' },
] as const;

/**
 * The source of customers imported from KiotViet (ADR-017). Seeded by key on the first import only,
 * so businesses without KiotViet never see it; then editable and archivable like the defaults.
 */
export const KIOTVIET_SOURCE = { key: 'kiotviet', name: 'KiotViet', color: '#0070f4' } as const;

/**
 * The source of customers that signed up on the Rapiz platform (Rapiz HQ, ADR-021). Seeded by key
 * on the first synced account only, like KiotViet.
 */
export const RAPIZ_SOURCE = { key: 'rapiz', name: 'Đăng ký Rapiz', color: '#7c3aed' } as const;

/** The built-in source a linked system's new customers get. */
export const EXTERNAL_SOURCE_OPTION = { kiotviet: KIOTVIET_SOURCE, rapiz: RAPIZ_SOURCE } as const;

export const DEFAULT_STATUSES = [
  { key: 'new_data', name: 'New data', color: '#64748b' },
  { key: 'call', name: 'Cuộc gọi', color: '#0ea5e9' },
  { key: 'qualified', name: 'Đúng chăm sóc', color: '#6366f1' },
  { key: 'browsing', name: 'Tham khảo', color: '#a855f7' },
  { key: 'zalo_care', name: 'Chăm sóc zalo', color: '#0068ff' },
  { key: 'trial', name: 'Trial', color: '#f59e0b' },
  { key: 'won', name: 'Chốt đơn', color: '#16a34a' },
  { key: 'closed', name: 'Đóng', color: '#ef4444' },
] as const;

/**
 * A SaaS business tracks one customer from lead to subscriber (ADR-020): the subscription stage
 * moves `trial` → `free_plan` / `paying` / `past_due` / `churned`, the bot moves a lead to
 * `requested`; staff move it to `demo_scheduled` (spec §6.4). Migration 0054 adds the two later
 * statuses to businesses seeded before.
 */
export const SAAS_STATUSES = [
  { key: 'new_lead', name: 'Lead mới', color: '#64748b' },
  { key: 'contacted', name: 'Đã liên hệ', color: '#0ea5e9' },
  { key: 'requested', name: 'Xin demo / dùng thử', color: '#6366f1' },
  { key: 'demo_scheduled', name: 'Đã hẹn demo', color: '#8b5cf6' },
  { key: 'trial', name: 'Dùng thử', color: '#f59e0b' },
  { key: 'free_plan', name: 'Dùng gói miễn phí', color: '#94a3b8' },
  { key: 'paying', name: 'Khách trả phí', color: '#16a34a' },
  { key: 'past_due', name: 'Quá hạn thanh toán', color: '#f97316' },
  { key: 'churned', name: 'Rời bỏ', color: '#ef4444' },
] as const;

/**
 * A language or training centre (ESV spec §5.1): the bot moves a lead to `test_requested` (placement
 * test, trial class) or `consulting`; staff schedule, test and enrol.
 */
export const EDUCATION_STATUSES = [
  { key: 'new_lead', name: 'Lead mới', color: '#64748b' },
  { key: 'consulting', name: 'Đang tư vấn', color: '#0ea5e9' },
  { key: 'test_requested', name: 'Đăng ký test / học thử', color: '#6366f1' },
  { key: 'test_scheduled', name: 'Đã hẹn test / học thử', color: '#8b5cf6' },
  { key: 'tested', name: 'Đã test / học thử', color: '#f59e0b' },
  { key: 'enrolled', name: 'Đã đăng ký học', color: '#16a34a' },
  { key: 'lost', name: 'Không theo học', color: '#ef4444' },
] as const;

/**
 * A spa, salon or beauty clinic (ESV spec §5.1): the bot moves a customer to `booking_requested`
 * or `consulting`; staff confirm the slot (`booked`) and record the visit.
 */
export const SPA_STATUSES = [
  { key: 'new_lead', name: 'Khách mới', color: '#64748b' },
  { key: 'consulting', name: 'Đang tư vấn', color: '#0ea5e9' },
  { key: 'booking_requested', name: 'Yêu cầu đặt lịch', color: '#6366f1' },
  { key: 'booked', name: 'Đã xác nhận lịch', color: '#8b5cf6' },
  { key: 'visited', name: 'Đã đến', color: '#16a34a' },
  { key: 'no_show', name: 'Không đến', color: '#f97316' },
  { key: 'lost', name: 'Không quan tâm', color: '#ef4444' },
] as const;

/** Statuses a business starts with, by industry. */
export const defaultStatusesFor = (
  industry: string,
): ReadonlyArray<{ key: string; name: string; color: string }> => {
  switch (industry) {
    case 'saas':
      return SAAS_STATUSES;
    case 'education':
      return EDUCATION_STATUSES;
    case 'spa':
      return SPA_STATUSES;
    default:
      return DEFAULT_STATUSES;
  }
};

/** System tags (field schemas are our own; the reference only shows field counts). */
export const DEFAULT_TAGS = [
  {
    key: 'vip',
    name: 'VIP',
    color: '#8b5cf6',
    type: 'attribute' as const,
    description: 'Khách có giá trị cao – ưu đãi cao',
    fields: [
      {
        key: 'level',
        label: 'Hạng',
        type: 'select' as const,
        required: false,
        archived: false,
        options: [
          { id: 'silver', label: 'Bạc', archived: false },
          { id: 'gold', label: 'Vàng', archived: false },
          { id: 'diamond', label: 'Kim cương', archived: false },
        ],
      },
      {
        key: 'since',
        label: 'Từ ngày',
        type: 'date' as const,
        required: false,
        archived: false,
        options: [],
      },
      {
        key: 'note',
        label: 'Ghi chú',
        type: 'text' as const,
        required: false,
        archived: false,
        options: [],
      },
    ],
  },
  {
    key: 'event',
    name: 'Event',
    color: '#10b981',
    type: 'attribute' as const,
    description: 'Khách tham gia sự kiện, ưu đãi liên quan',
    fields: [
      {
        key: 'event_name',
        label: 'Tên sự kiện',
        type: 'text' as const,
        required: true,
        archived: false,
        options: [],
      },
      {
        key: 'event_date',
        label: 'Ngày',
        type: 'date' as const,
        required: false,
        archived: false,
        options: [],
      },
      {
        key: 'attended',
        label: 'Đã tham gia',
        type: 'boolean' as const,
        required: false,
        archived: false,
        options: [],
      },
    ],
  },
  {
    key: 'ticket',
    name: 'Ticket',
    color: '#f59e0b',
    type: 'attribute' as const,
    description: 'Ghi nhận và phân công vấn đề để xử lý nội bộ',
    fields: [
      {
        key: 'subject',
        label: 'Vấn đề',
        type: 'text' as const,
        required: true,
        archived: false,
        options: [],
      },
      {
        key: 'priority',
        label: 'Mức độ',
        type: 'select' as const,
        required: false,
        archived: false,
        options: [
          { id: 'low', label: 'Thấp', archived: false },
          { id: 'normal', label: 'Bình thường', archived: false },
          { id: 'high', label: 'Cao', archived: false },
        ],
      },
    ],
  },
];
