import type { CreateTrainingItemRequest } from '@agent-sales/contracts';

/**
 * The Vietnamese starter pack every new bot gets (T-070). The rules are product copy, written in
 * Vietnamese on purpose, and fully editable by the owner. The table has no stable key column, so
 * the exact title is the identity used to keep seeding idempotent: renaming a rule makes the pack
 * re-add the original on the next seed, deleting it does too.
 *
 * The price rule gives no sample amount on purpose: rule text is trusted text for number
 * grounding, so an example like "99k" would vouch for an invented 99k price.
 *
 * Deliberately absent: any rule that creates an order without the customer's confirmation or that
 * skips asking for the customer's name, any shop policy claim (COD, inspection: the payment rule
 * only defers to the shop data), and a language rule (the prompt follows the bot and customer
 * language).
 */
type StarterRule = Pick<CreateTrainingItemRequest, 'title' | 'trigger' | 'content' | 'section'>;

const SHARED_RULES: readonly StarterRule[] = [
  {
    title: 'Cách nói giá',
    trigger: 'Khi báo giá',
    content:
      'Giá tròn nghìn viết gọn bằng chữ "k" đặt sau con số, không viết đủ ba số không và chữ "đ". Chỉ báo mức giá có trong dữ liệu của cửa hàng.',
    section: 'general',
  },
  {
    title: 'Khách quan tâm sản phẩm',
    trigger: 'Khách hỏi giá, hỏi size hoặc nói thích một sản phẩm',
    content:
      'Sau khi trả lời, xin số điện thoại và địa chỉ nhận hàng để lên đơn cho khách, trừ khi đã có thông tin này trong cuộc trò chuyện.',
    section: 'general',
  },
  {
    title: 'Khách hỏi về thanh toán',
    trigger: 'Khách hỏi cách thanh toán hoặc có phải trả trước không',
    content:
      'Khi khách hỏi về thanh toán, chỉ trả lời theo thông tin cửa hàng đã cung cấp trong dữ liệu; nếu chưa có thông tin, nói em chưa rõ và mời khách để lại số điện thoại để nhân viên hỗ trợ.',
    section: 'general',
  },
  {
    title: 'Sau khi chốt đơn',
    trigger: 'Ngay sau khi đơn hàng hoặc lịch hẹn vừa được tạo thành công',
    content: 'Cảm ơn khách thật ngắn gọn, tối đa 20 từ.',
    section: 'after_order',
  },
];

export const STARTER_RULES: readonly StarterRule[] = SHARED_RULES;
const AFTER_ORDER = SHARED_RULES.filter((r) => r.section === 'after_order');

const HOTEL_RULES: readonly StarterRule[] = [
  {
    title: 'Hỏi còn phòng/căn',
    trigger: 'Khách hỏi còn phòng/căn ngày nào',
    content:
      'Hỏi ngày nhận/trả và số khách, xin số điện thoại để nhân viên kiểm tra lịch trống. Không tự khẳng định còn phòng/căn.',
    section: 'general',
  },
  {
    title: 'Muốn đặt phòng/căn',
    trigger: 'Khách muốn đặt',
    content:
      'Tóm tắt lại ngày và số khách, xin số điện thoại, báo nhân viên sẽ gọi xác nhận và hướng dẫn đặt cọc theo thông tin cửa hàng.',
    section: 'general',
  },
  {
    title: 'Mặc cả giá',
    trigger: 'Khách xin giảm giá hoặc mặc cả',
    content: 'Không tự giảm giá. Nói sẽ chuyển nhân viên xem ưu đãi cho khách.',
    section: 'general',
  },
  {
    title: 'Hỏi đường đi',
    trigger: 'Khách hỏi đường hoặc cách di chuyển',
    content: 'Trả lời theo thông tin đường đi/đưa đón và link bản đồ trong thông tin của cửa hàng.',
    section: 'general',
  },
  ...AFTER_ORDER,
];

/**
 * The situations a bot of this industry starts with. Style rules (address, length, no waiting)
 * are not seeded: they are personality settings. Unknown industries get the shared pack.
 */
export function starterRulesFor(industry: string): readonly StarterRule[] {
  return industry === 'hotel' ? HOTEL_RULES : STARTER_RULES;
}

/** The starter pack of an industry as create requests (kind scenario, enabled). */
export function starterRuleRequests(industry = ''): CreateTrainingItemRequest[] {
  return starterRulesFor(industry).map((rule) => ({
    ...rule,
    kind: 'scenario',
    mediaUrl: null,
    folderId: null,
    enabled: true,
  }));
}
