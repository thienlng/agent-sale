import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { backfillBotProfiles } from './bot-profile-backfill.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';

/**
 * T-141: copies `settings.placeholders` into `settings.profile.fields`, drops seeded FAQs and
 * style rules that are still exactly the legacy seed, keeps everything the owner edited or wrote.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };

const user = newId();
const wsA = newId();
const wsB = newId();
const retailBot = newId(); // TinyMind-like
const villasBot = newId();
const otherBot = newId(); // identical content, other workspace

const exec = (q: ReturnType<typeof sql>) => owner.db.execute(q);
const rows = async <T>(q: ReturnType<typeof sql>) => (await exec(q)) as unknown as T[];

const LEGACY_FAQS: [string, string][] = [
  ['Cửa hàng ở đâu?', 'Dạ, địa chỉ của {{store.name}} là {{store.address}} ạ.'],
  ['Giờ mở cửa thế nào?', 'Dạ, bên em mở cửa {{store.hours}} ạ.'],
  ['Thanh toán bằng những hình thức nào?', 'Dạ, bên em nhận thanh toán: {{payment.methods}} ạ.'],
  ['Số điện thoại / hotline là gì?', 'Dạ, hotline của bên em là {{store.hotline}} ạ.'],
  ['Phí ship bao nhiêu, giao mất mấy ngày?', 'Dạ, {{shipping.policy}} ạ.'],
  ['Có được đổi trả không?', 'Dạ, chính sách đổi trả: {{return.policy}} ạ.'],
];
const LEGACY_RULES: [string, string, string][] = [
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

async function seedFaq(ws: string, bot: string, q: string, a: string) {
  await exec(sql`insert into knowledge_items (id, workspace_id, bot_id, question, answer, search_text)
    values (${newId()}, ${ws}, ${bot}, ${q}, ${a}, '')`);
}
async function seedRule(ws: string, bot: string, title: string, trigger: string, content: string) {
  await exec(sql`insert into training_items (id, workspace_id, bot_id, kind, title, trigger, content)
    values (${newId()}, ${ws}, ${bot}, 'scenario', ${title}, ${trigger}, ${content})`);
}
const settingsOf = async (bot: string) =>
  (
    await rows<{ settings: Record<string, unknown> }>(
      sql`select settings from bots where id = ${bot}`,
    )
  )[0]!.settings;
const count = async (table: 'knowledge_items' | 'training_items', bot: string) =>
  (
    await rows<{ n: number }>(
      sql`select count(*)::int as n from ${sql.raw(table)} where bot_id = ${bot}`,
    )
  )[0]!.n;

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });

  await exec(sql`insert into users (id, email, name) values (${user}, 'o@example.test', 'O')`);
  for (const ws of [wsA, wsB])
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, 'Shop', 'retail', ${user})`);

  const placeholders = {
    'store.name': 'TinyMind',
    'store.address': '1 Le Loi',
    'store.hotline': '0900',
    'store.hours': '8-22',
    'payment.methods': 'COD, chuyen khoan',
    'shipping.policy': 'Free ship tren 500k',
    'return.policy': 'Doi tra 7 ngay',
  };
  await exec(sql`insert into bots (id, workspace_id, name, industry, settings) values
    (${retailBot}, ${wsA}, 'TinyMind', 'retail', ${JSON.stringify({
      placeholders,
      profile: { fields: { hotline: 'KEEP-0911' }, notes: '' },
    })}::jsonb),
    (${villasBot}, ${wsA}, 'Villas', 'hotel', '{"placeholders":{}}'::jsonb),
    (${otherBot}, ${wsB}, 'Other', 'retail', ${JSON.stringify({ placeholders })}::jsonb)`);

  for (const bot of [
    [wsA, retailBot],
    [wsB, otherBot],
  ] as const) {
    for (const [q, a] of LEGACY_FAQS) await seedFaq(bot[0], bot[1], q, a);
    for (const [t, tr, c] of LEGACY_RULES) await seedRule(bot[0], bot[1], t, tr, c);
  }
  // Edited seed FAQ, user FAQ, edited style rule, user situation on the retail bot.
  await seedFaq(wsA, retailBot, 'Cửa hàng ở đâu?', 'Dạ, ở 1 Lê Lợi, gần chợ ạ.');
  await seedFaq(wsA, retailBot, 'Có freeship không?', 'Dạ có ạ.');
  await seedRule(wsA, retailBot, 'Xưng hô lịch sự', 'Mọi câu trả lời', 'Nói "dạ" thôi.');
  await seedRule(
    wsA,
    retailBot,
    'Khi khách khiếu nại',
    'Khách bực',
    'Xin lỗi và chuyển nhân viên.',
  );
  // Villas: only unchanged FAQs, no rules.
  for (const [q, a] of LEGACY_FAQS.slice(0, 4)) await seedFaq(wsA, villasBot, q, a);
});

afterAll(async () => {
  await system?.close();
  await owner?.close();
  await pg?.stop();
});

describe('bot profile backfill (T-141)', () => {
  it('changes nothing in a dry run and reports counts per bot', async () => {
    const report = await backfillBotProfiles(system.db, { dryRun: true });
    expect(report.dryRun).toBe(true);
    const retail = report.bots.find((b) => b.botId === retailBot);
    expect(retail).toEqual({
      botId: retailBot,
      fieldsCopied: 6,
      fieldsSkippedTooLong: 0,
      faqsDeleted: 6,
      rulesDeleted: 4,
      personalitySet: ['replyLength'],
    });
    expect(await count('knowledge_items', retailBot)).toBe(8);
    expect(await count('training_items', retailBot)).toBe(6);
    expect((await settingsOf(retailBot))['replyLength']).toBeUndefined();
  });

  it('copies mapped fields, deletes only unchanged seeds and keeps the rest', async () => {
    const report = await backfillBotProfiles(system.db, { dryRun: false });
    expect(report.bots.map((b) => b.botId).sort()).toEqual([retailBot, villasBot, otherBot].sort());
    expect(report.bots.find((b) => b.botId === villasBot)).toEqual({
      botId: villasBot,
      fieldsCopied: 0,
      fieldsSkippedTooLong: 0,
      faqsDeleted: 4,
      rulesDeleted: 0,
      personalitySet: [],
    });

    const s = await settingsOf(retailBot);
    expect(s['profile']).toEqual({
      fields: {
        hotline: 'KEEP-0911', // never overwritten
        displayName: 'TinyMind',
        address: '1 Le Loi',
        hours: '8-22',
        payment: 'COD, chuyen khoan',
        shipping: 'Free ship tren 500k',
        returns: 'Doi tra 7 ngay',
      },
      notes: '',
    });
    expect(s['replyLength']).toBe('short');
    expect((s['placeholders'] as Record<string, string>)['store.name']).toBe('TinyMind');

    const faqs = await rows<{ question: string }>(
      sql`select question from knowledge_items where bot_id = ${retailBot} order by question`,
    );
    expect(faqs.map((f) => f.question).sort()).toEqual(
      ['Có freeship không?', 'Cửa hàng ở đâu?'].sort(),
    );
    const rules = await rows<{ title: string }>(
      sql`select title from training_items where bot_id = ${retailBot}`,
    );
    expect(rules.map((r) => r.title).sort()).toEqual(
      ['Khi khách khiếu nại', 'Xưng hô lịch sự'].sort(),
    );
    expect(await count('knowledge_items', villasBot)).toBe(0);
  });

  it('migrates a bot of another workspace only in its own scope', async () => {
    expect(await count('knowledge_items', otherBot)).toBe(0);
    expect(await count('training_items', otherBot)).toBe(0);
    expect((await settingsOf(otherBot))['profile']).toMatchObject({
      fields: { displayName: 'TinyMind' },
    });
  });

  it('is idempotent', async () => {
    const again = await backfillBotProfiles(system.db, { dryRun: false });
    expect(again.bots).toEqual([]);
    expect(await count('knowledge_items', retailBot)).toBe(2);
  });
});

describe('replyLength mapping (T-141 fix)', () => {
  const [nullNoRule, nullWithRule, detailedWithRule] = [newId(), newId(), newId()];
  const shortRule = LEGACY_RULES[2]!;

  beforeAll(async () => {
    for (const [bot, replyLength] of [
      [nullNoRule, null],
      [nullWithRule, null],
      [detailedWithRule, 'detailed'],
    ] as const)
      await exec(sql`insert into bots (id, workspace_id, name, industry, settings) values
        (${bot}, ${wsA}, 'Bot', 'retail', ${JSON.stringify({ replyLength })}::jsonb)`);
    await seedFaq(wsA, nullNoRule, 'Câu hỏi riêng', 'Trả lời riêng');
    for (const bot of [nullWithRule, detailedWithRule])
      await seedRule(wsA, bot, shortRule[0], shortRule[1], shortRule[2]);
  });

  it('sets short only when the legacy short rule was removed and the bot has no length', async () => {
    const report = await backfillBotProfiles(system.db, { dryRun: false });
    expect(report.bots.map((b) => b.botId).sort()).toEqual([nullWithRule, detailedWithRule].sort());
    expect((await settingsOf(nullNoRule))['replyLength']).toBeNull();
    expect((await settingsOf(nullWithRule))['replyLength']).toBe('short');
    expect((await settingsOf(detailedWithRule))['replyLength']).toBe('detailed');
    expect(await count('training_items', nullWithRule)).toBe(0);
    expect(await count('training_items', detailedWithRule)).toBe(0);
  });
});

describe('over-length placeholder values (T-141 fix)', () => {
  const longBot = newId();

  beforeAll(async () => {
    await exec(sql`insert into bots (id, workspace_id, name, industry, settings) values
      (${longBot}, ${wsA}, 'Long', 'retail', ${JSON.stringify({
        placeholders: { 'store.hotline': '0'.repeat(61), 'store.hours': '8-22' },
      })}::jsonb)`);
  });

  it('skips a value longer than the field allows, counts it, and copies the rest', async () => {
    const report = await backfillBotProfiles(system.db, { dryRun: false });
    expect(report.bots.find((b) => b.botId === longBot)).toEqual({
      botId: longBot,
      fieldsCopied: 1,
      fieldsSkippedTooLong: 1,
      faqsDeleted: 0,
      rulesDeleted: 0,
      personalitySet: [],
    });
    const profile = (await settingsOf(longBot))['profile'] as { fields: Record<string, string> };
    expect(profile.fields).toEqual({ hours: '8-22' });
  });
});
