import { copyFile, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { migrate, MIGRATIONS_DIR } from './migrate.js';

/**
 * Upgrading an install that already has conversations into the inbox v2 (migration 0024, T-073):
 * the index columns are derived from the stored document and the message log, and the legacy
 * single note becomes the first entry of the notes timeline.
 */
let pg: TestPostgres;
let db: { db: Database; close: () => Promise<void> };

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

const ws = newId();
const channel = newId();
const assignee = newId();
/** Conversations as the T-068 inbox stored them (no v2 fields in the document). */
const waiting = newId(); // the customer wrote last, after an earlier staff reply
const answered = newId(); // the shop wrote last
const resolved = newId(); // the customer wrote last but it is resolved
const bare = newId(); // no messages at all, carries a legacy note

const doc = (id: string, over: Record<string, unknown>) => ({
  id,
  channelId: channel,
  provider: 'facebook',
  customerId: id,
  customerName: id,
  mode: 'bot',
  autoResumeAt: null,
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 1,
  lastMessage: 'x',
  lastInboundAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  ...over,
});

const conversation = (id: string, data: Record<string, unknown>) =>
  db.db
    .execute(sql`insert into conversations (id, workspace_id, channel_id, customer_id, data, updated_at)
    values (${id}, ${ws}, ${channel}, ${id}, ${JSON.stringify(data)}::jsonb, ${data.updatedAt as string})`);

const message = (
  conversationId: string,
  direction: 'inbound' | 'outbound',
  sender: string,
  at: string,
) =>
  db.db
    .execute(sql`insert into conversation_messages (id, workspace_id, conversation_id, idempotency_key, data, created_at)
    values (${newId()}, ${ws}, ${conversationId}, ${newId()},
      ${JSON.stringify({ direction, sender, text: 'm' })}::jsonb, ${at})`);

beforeAll(async () => {
  pg = await startTestPostgres();
  db = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0023_crm_starting_state_events.sql'));
  const owner = newId();
  await db.db.execute(
    sql`insert into users (id, email, name) values (${owner}, ${`${owner}@example.test`}, 'Owner')`,
  );
  await db.db.execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Shop', 'retail', ${owner})`);
  await db.db
    .execute(sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed)
    values (${channel}, ${ws}, 'facebook', 'page', 'Page', 'sealed')`);

  await conversation(waiting, doc(waiting, { assigneeId: assignee, note: '' }));
  await message(waiting, 'inbound', 'customer', '2026-10-20T08:00:00Z');
  await message(waiting, 'outbound', 'bot', '2026-10-20T08:01:00Z');
  await message(waiting, 'inbound', 'customer', '2026-10-20T09:00:00Z');
  await message(waiting, 'inbound', 'customer', '2026-10-20T09:30:00Z');

  await conversation(answered, doc(answered, { mode: 'human', note: 'VIP' }));
  await message(answered, 'inbound', 'customer', '2026-10-20T08:00:00Z');
  await message(answered, 'outbound', 'human', '2026-10-20T08:05:00Z');

  await conversation(resolved, doc(resolved, { status: 'resolved' }));
  await message(resolved, 'inbound', 'customer', '2026-10-20T08:00:00Z');

  await conversation(bare, doc(bare, { note: 'Call back tomorrow' }));

  await migrate(pg.ownerUrl);
});

afterAll(async () => {
  await db?.close();
  await pg?.stop();
});

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

const row = async (id: string) =>
  (
    await db.db.execute<{
      unread_count: number;
      awaiting_since: string | null;
      assignee_id: string | null;
      mode: string;
      status: string;
      customer_phone: string | null;
      created_at: string;
      data: Record<string, unknown>;
    }>(sql`select * from conversations where id = ${id}`)
  )[0]!;

describe('inbox v2 backfill (0024)', () => {
  it('derives the index columns from the document', async () => {
    expect(await row(waiting)).toMatchObject({
      unread_count: 0,
      assignee_id: assignee,
      mode: 'bot',
      status: 'open',
      customer_phone: null,
    });
    expect((await row(answered)).mode).toBe('human');
    expect((await row(resolved)).status).toBe('resolved');
  });

  it('starts the wait at the first customer message after the last reply', async () => {
    const r = await row(waiting);
    expect(iso(r.awaiting_since)).toBe('2026-10-20T09:00:00.000Z');
    expect(r.data).toMatchObject({
      awaitingSince: '2026-10-20T09:00:00.000Z',
      lastMessageSender: 'customer',
      unreadCount: 0,
    });
  });

  it('does not mark answered or resolved conversations as waiting', async () => {
    expect((await row(answered)).awaiting_since).toBeNull();
    expect((await row(answered)).data).toMatchObject({
      awaitingSince: null,
      lastMessageSender: 'human',
    });
    expect((await row(resolved)).awaiting_since).toBeNull();
    expect((await row(bare)).awaiting_since).toBeNull();
  });

  it('dates the conversation from its first message', async () => {
    expect(iso((await row(waiting)).created_at)).toBe('2026-10-20T08:00:00.000Z');
    expect((await row(waiting)).data.createdAt).toBe('2026-10-20T08:00:00.000Z');
    // Without messages the last update is the best known date.
    expect(iso((await row(bare)).created_at)).toBe('2026-10-20T10:00:00.000Z');
  });

  it('turns the legacy note into the first entry of the notes timeline', async () => {
    const notes = (await row(answered)).data.notes as Record<string, unknown>[];
    expect(notes).toEqual([
      expect.objectContaining({ authorId: null, authorName: '', text: 'VIP' }),
    ]);
    expect(notes[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await row(answered)).data.note).toBe('VIP');
    expect((await row(waiting)).data.notes).toEqual([]);
  });

  it('is safe to apply again: documents already carrying v2 fields keep them', async () => {
    const before = (await row(answered)).data.notes;
    await db.db.execute(
      sql.raw(await readFile(path.join(MIGRATIONS_DIR, '0024_inbox_v2.sql'), 'utf8')),
    );
    expect((await row(answered)).data.notes).toEqual(before);
  });
});
