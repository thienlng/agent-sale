/** CRM fixtures with long Vietnamese content for the layout guard. */
const now = '2026-10-24T08:00:00.000Z';
const id = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e${String(n).padStart(2, '0')}`;
const LONG_NAME = 'Nguyễn Thị Thanh Hương Lan Anh Phương Thảo Ngọc Bích';
export const CONTACT_ID = id(1);

const option = (n: number, name: string, color: string, key: string | null = null) => ({
  id: id(10 + n),
  key,
  name,
  color,
  position: n,
  archived: n === 6,
});
const statuses = [
  'New data',
  'Cuộc gọi',
  'Đúng chăm sóc',
  'Tham khảo',
  'Chăm sóc zalo qua tin nhắn dài',
  'Trial',
  'Chốt đơn',
  'Đóng',
].map((name, i) => option(i, name, '#6366f1', `s${i}`));
const sources = ['Facebook', 'Zalo', 'Hội chợ thời trang mùa thu Sài Gòn 2026'].map((name, i) =>
  option(20 + i, name, '#0ea5e9'),
);
const tag = {
  id: id(40),
  name: 'Khách sỉ khu vực miền Nam',
  color: '#8b5cf6',
  type: 'attribute',
  description: 'Khách mua sỉ từ 50 sản phẩm trở lên, giao hàng theo tuyến cố định hằng tuần',
  fields: [
    {
      key: 'tier',
      label: 'Hạng',
      type: 'select',
      required: false,
      archived: false,
      options: [{ id: 'a', label: 'A', archived: false }],
    },
  ],
  schemaVersion: 1,
  isSystem: false,
  archived: false,
  createdByName: LONG_NAME,
  activeCount: 12_345,
  version: 1,
  updatedAt: now,
};
const assignment = {
  id: id(41),
  tagId: tag.id,
  scope: 'contact',
  entityId: CONTACT_ID,
  values: { tier: 'a' },
  schemaVersion: 1,
  assignedAt: now,
  assignedByName: LONG_NAME,
  removedAt: null,
  version: 1,
};
const contact = {
  id: CONTACT_ID,
  name: LONG_NAME,
  phone: '0912 345 678',
  phoneNormalized: '+84912345678',
  email: 'nguyen.thi.thanh.huong.lan@mot-ten-mien-rat-dai.vn',
  birthday: '1990-05-01',
  gender: 'female',
  address: '123/45/67 Đường Nguyễn Thị Minh Khai, Phường Bến Thành',
  province: 'Thành phố Hồ Chí Minh',
  ward: 'Phường Bến Thành',
  phoneProvidedAt: now,
  addressProvidedAt: now,
  sourceId: sources[2]?.id ?? null,
  firstSourceId: sources[2]?.id ?? null,
  statusId: statuses[4]?.id ?? null,
  salesUserId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  careUserId: null,
  adRef: 'FB-ADS-2026-10-CAMPAIGN-THOI-TRANG',
  profileNote: 'Thích màu pastel, size M, hay hỏi giao trong ngày',
  tags: [
    assignment,
    { ...assignment, id: id(42) },
    { ...assignment, id: id(43) },
    { ...assignment, id: id(44) },
  ],
  version: 3,
  createdAt: now,
  updatedAt: now,
};

/** Response for a CRM path, or undefined when the path is not a CRM one. */
export function crmRoute(path: string): unknown {
  if (path === '/contacts/query')
    return {
      data: Array.from({ length: 8 }, (_, i) => ({ ...contact, id: i ? id(60 + i) : CONTACT_ID })),
      total: 123_456,
      page: 1,
      pageSize: 20,
    };
  if (path === `/contacts/${CONTACT_ID}`) return contact;
  if (path === `/contacts/${CONTACT_ID}/notes`)
    return {
      data: [
        {
          id: id(50),
          body: `${LONG_NAME} hỏi về đơn sỉ 200 áo sơ mi, cần báo giá trước thứ Sáu.`,
          authorName: LONG_NAME,
          createdAt: now,
          editedAt: now,
          version: 2,
        },
      ],
    };
  if (path === `/contacts/${CONTACT_ID}/history`)
    return {
      data: [
        {
          id: id(51),
          type: 'contact.updated',
          changes: { address: { from: null, to: contact.address } },
          data: {},
          actorName: LONG_NAME,
          at: now,
        },
        {
          id: id(52),
          type: 'tag.added',
          changes: {},
          data: { tagName: tag.name },
          actorName: LONG_NAME,
          at: now,
        },
      ],
    };
  if (path === `/contacts/${CONTACT_ID}/tags`) return { data: [assignment] };
  if (path === '/crm/statuses') return { data: statuses };
  if (path === '/crm/sources') return { data: sources };
  if (path === '/crm/tags')
    return { data: [tag, { ...tag, id: id(45), type: 'classification', fields: [] }] };
  if (path === '/crm/assignees')
    return {
      data: [{ userId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10', name: LONG_NAME, role: 'owner' }],
    };
  if (path === '/saved-views')
    return {
      data: [
        {
          id: id(70),
          name: 'Khách VIP miền Nam chưa mua lại trong 90 ngày',
          visibility: 'shared',
          isOwner: false,
          ownerName: LONG_NAME,
          q: '',
          filter: { v: 1, match: 'all', rules: [], duplicatesOnly: false },
          sort: [{ field: 'createdAt', dir: 'desc' }],
          columns: [],
          version: 1,
          updatedAt: now,
        },
      ],
    };
  return undefined;
}
