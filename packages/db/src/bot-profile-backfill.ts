import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { withSystem } from './tenant.js';

export interface BotProfileBackfillReport {
  dryRun: boolean;
  /** Only bots where something changed (or would change in a dry run). Ids and counts only. */
  bots: {
    botId: string;
    fieldsCopied: number;
    faqsDeleted: number;
    rulesDeleted: number;
    personalitySet: string[];
  }[];
}

class DryRunRollback extends Error {}

type Row = Record<string, unknown>;

/** Legacy `settings.placeholders` key -> `settings.profile.fields` key (spec §6). */
const PLACEHOLDER_TO_FIELD: Readonly<Record<string, string>> = {
  'store.name': 'displayName',
  'store.address': 'address',
  'store.hotline': 'hotline',
  'store.hours': 'hours',
  'payment.methods': 'payment',
  'shipping.policy': 'shipping',
  'return.policy': 'returns',
  'size.guide': 'sizeGuide',
  'product.authenticity': 'authenticity',
  'service.prices': 'servicePrices',
  'course.fees': 'courseFees',
  'course.schedule': 'courseSchedule',
  'course.trial': 'courseTrial',
  'hotel.rates': 'rates',
  'hotel.checkin_checkout': 'checkInOut',
  'hotel.cancellation': 'cancellation',
  'solar.price_range': 'priceRange',
  'solar.payback': 'payback',
  'solar.warranty': 'warranty',
};

/**
 * Frozen copy of every FAQ the industry packs seeded (apps/backend bot/domain/packs.ts at
 * commit 798879a, answers stored unfilled with their `{{placeholders}}`). packages/db must not
 * import apps/backend, and this must not follow later pack edits: it names what old bots hold.
 */
const LEGACY_SEED_FAQS: readonly (readonly [question: string, answer: string])[] = [
  ['Cửa hàng ở đâu?', 'Dạ, địa chỉ của {{store.name}} là {{store.address}} ạ.'],
  ['Giờ mở cửa thế nào?', 'Dạ, bên em mở cửa {{store.hours}} ạ.'],
  ['Thanh toán bằng những hình thức nào?', 'Dạ, bên em nhận thanh toán: {{payment.methods}} ạ.'],
  ['Số điện thoại / hotline là gì?', 'Dạ, hotline của bên em là {{store.hotline}} ạ.'],
  ['Phí ship bao nhiêu, giao mất mấy ngày?', 'Dạ, {{shipping.policy}} ạ.'],
  ['Có được đổi trả không?', 'Dạ, chính sách đổi trả: {{return.policy}} ạ.'],
  ['Chọn size thế nào?', 'Dạ, bảng size của bên em: {{size.guide}} ạ.'],
  ['Sản phẩm có chính hãng không?', 'Dạ, {{product.authenticity}} ạ.'],
  ['Bảng giá dịch vụ thế nào?', 'Dạ, bảng giá dịch vụ: {{service.prices}} ạ.'],
  [
    'Đặt lịch như thế nào?',
    'Dạ, anh/chị cho em xin dịch vụ, ngày giờ mong muốn và số điện thoại, bên em sẽ xác nhận lịch ạ.',
  ],
  ['Chi phí khám bao nhiêu?', 'Dạ, chi phí khám: {{service.prices}} ạ.'],
  ['Học phí bao nhiêu?', 'Dạ, học phí: {{course.fees}} ạ.'],
  ['Lịch học thế nào?', 'Dạ, lịch học: {{course.schedule}} ạ.'],
  ['Có học thử không?', 'Dạ, {{course.trial}} ạ.'],
  ['Giờ nhận phòng và trả phòng?', 'Dạ, {{hotel.checkin_checkout}} ạ.'],
  ['Giá phòng bao nhiêu?', 'Dạ, giá phòng tham khảo: {{hotel.rates}} ạ.'],
  ['Chính sách huỷ phòng thế nào?', 'Dạ, {{hotel.cancellation}} ạ.'],
  ['Lắp điện mặt trời giá bao nhiêu?', 'Dạ, {{solar.price_range}} ạ.'],
  ['Bao lâu thì hoàn vốn?', 'Dạ, {{solar.payback}} ạ.'],
  ['Bảo hành thế nào?', 'Dạ, {{solar.warranty}} ạ.'],
];

/**
 * Frozen copy of the four "every reply" style rules the old starter pack seeded
 * (apps/backend knowledge/domain/starter-rules.ts at 798879a). The pronoun rules need no
 * mapping (the bot keeps its own pronoun settings); the length rule maps to `replyLength`.
 */
const LEGACY_STYLE_RULES: readonly (readonly [title: string, trigger: string, content: string])[] =
  [
    [
      'Xưng hô lịch sự',
      'Mọi câu trả lời',
      'Luôn mở đầu hoặc kết câu lịch sự bằng "dạ" và "ạ", giọng thân thiện, tôn trọng khách.',
    ],
    [
      'Cách gọi khách',
      'Mọi câu trả lời',
      'Gọi khách là anh/chị và xưng "em". Khi chưa rõ giới tính của khách thì gọi "bạn" và xưng "mình".',
    ],
    [
      'Trả lời ngắn gọn',
      'Mọi câu trả lời',
      'Mỗi câu trả lời tối đa 40 từ, đi thẳng vào ý khách hỏi, không dài dòng.',
    ],
    [
      'Không bảo khách chờ',
      'Mọi câu trả lời',
      'Không nói khách chờ hoặc hẹn trả lời sau, trừ khi chuyển cuộc trò chuyện cho nhân viên. Trả lời ngay bằng thông tin hiện có của cửa hàng.',
    ],
  ];

const SHORT_RULE_TITLE = 'Trả lời ngắn gọn';
const key = (...parts: string[]) => JSON.stringify(parts);
const FAQ_KEYS = new Set(LEGACY_SEED_FAQS.map((f) => key(...f)));
const RULE_KEYS = new Set(LEGACY_STYLE_RULES.map((r) => key(...r)));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/**
 * T-141 (spec §6): moves legacy bot data into the structured profile. Per bot, in one
 * transaction: copies `settings.placeholders` into empty `settings.profile.fields` (never
 * overwrites), deletes seeded FAQs and style rules that still equal the legacy seed exactly
 * (anything edited or user-written is kept), and maps the deleted length rule to
 * `replyLength: 'short'` when the bot has none. `settings.placeholders` stays untouched.
 * Idempotent. With `dryRun` each bot's transaction is rolled back, so the report is exact.
 * Runs as app_system and filters by workspace explicitly (the system role sees all tenants).
 */
export async function backfillBotProfiles(
  db: Database,
  opts: { dryRun: boolean },
): Promise<BotProfileBackfillReport> {
  const report: BotProfileBackfillReport = { dryRun: opts.dryRun, bots: [] };
  const bots = await withSystem(
    db,
    async (tx) =>
      (await tx.execute(
        sql`select id, workspace_id from bots where deleted_at is null order by workspace_id, id`,
      )) as unknown as Row[],
  );

  for (const bot of bots) {
    const botId = String(bot['id']);
    const ws = String(bot['workspace_id']);
    try {
      await withSystem(db, async (tx) => {
        const rows = async (q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as Row[];
        const current = await rows(
          sql`select settings from bots where id = ${botId} and workspace_id = ${ws} for update`,
        );
        const rawSettings: unknown = current[0]?.['settings'];
        const settings = isObject(rawSettings) ? rawSettings : {};
        const placeholders = isObject(settings['placeholders']) ? settings['placeholders'] : {};
        const profile = isObject(settings['profile']) ? settings['profile'] : {};
        const fields = isObject(profile['fields']) ? { ...profile['fields'] } : {};

        let fieldsCopied = 0;
        for (const [placeholder, field] of Object.entries(PLACEHOLDER_TO_FIELD)) {
          const value = placeholders[placeholder];
          if (isEmpty(value) || !isEmpty(fields[field])) continue;
          fields[field] = (value as string).trim();
          fieldsCopied += 1;
        }

        const faqs = await rows(sql`
          select id, question, answer from knowledge_items
          where bot_id = ${botId} and workspace_id = ${ws}`);
        const faqIds = faqs
          .filter((f) => FAQ_KEYS.has(key(String(f['question']), String(f['answer']))))
          .map((f) => String(f['id']));

        const rules = await rows(sql`
          select id, title, trigger, content from training_items
          where bot_id = ${botId} and workspace_id = ${ws} and kind = 'scenario'`);
        const seeded = rules.filter((r) =>
          RULE_KEYS.has(key(String(r['title']), String(r['trigger']), String(r['content']))),
        );

        const personalitySet: string[] = [];
        const patch: Record<string, unknown> = {};
        if (fieldsCopied > 0) patch['profile'] = { notes: '', ...profile, fields };
        if (
          (seeded.some((r) => r['title'] === SHORT_RULE_TITLE) &&
            settings['replyLength'] === undefined) ||
          settings['replyLength'] === null
        ) {
          patch['replyLength'] = 'short';
          personalitySet.push('replyLength');
        }

        for (const id of faqIds)
          await tx.execute(
            sql`delete from knowledge_items where id = ${id} and workspace_id = ${ws}`,
          );
        for (const r of seeded)
          await tx.execute(
            sql`delete from training_items where id = ${String(r['id'])} and workspace_id = ${ws}`,
          );
        if (Object.keys(patch).length > 0)
          await tx.execute(sql`
            update bots set settings = settings || ${JSON.stringify(patch)}::jsonb
            where id = ${botId} and workspace_id = ${ws}`);

        if (fieldsCopied + faqIds.length + seeded.length + personalitySet.length > 0)
          report.bots.push({
            botId,
            fieldsCopied,
            faqsDeleted: faqIds.length,
            rulesDeleted: seeded.length,
            personalitySet,
          });
        if (opts.dryRun) throw new DryRunRollback();
      });
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
  }
  return report;
}
