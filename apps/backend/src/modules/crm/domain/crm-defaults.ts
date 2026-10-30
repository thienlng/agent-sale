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
 * A SaaS business tracks one customer from lead to subscriber (ADR-014): the subscription stage
 * moves `trial` → `paying` / `past_due` / `churned`, the bot moves a lead to `requested`.
 */
export const SAAS_STATUSES = [
  { key: 'new_lead', name: 'Lead mới', color: '#64748b' },
  { key: 'contacted', name: 'Đã liên hệ', color: '#0ea5e9' },
  { key: 'requested', name: 'Xin demo / dùng thử', color: '#6366f1' },
  { key: 'trial', name: 'Dùng thử', color: '#f59e0b' },
  { key: 'paying', name: 'Khách trả phí', color: '#16a34a' },
  { key: 'past_due', name: 'Quá hạn thanh toán', color: '#f97316' },
  { key: 'churned', name: 'Rời bỏ', color: '#ef4444' },
] as const;

/** Statuses a business starts with, by industry. */
export const defaultStatusesFor = (industry: string) =>
  industry === 'saas' ? SAAS_STATUSES : DEFAULT_STATUSES;

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
