import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../migrate.js';
import { autonomySettings, conversationSignals } from './brain.js';
import {
  careCheckpoints,
  careEnrollments,
  careMessages,
  careTemplates,
  careUsage,
} from './care.js';

// Found by its name, not its number: the number may change when it is rebased onto main.
const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_care_agent\.sql$/.test(f));
const sqlText = () => readFileSync(join(MIGRATIONS_DIR, migrations[0] ?? ''), 'utf8').toLowerCase();

const tables: [string, PgTable][] = [
  ['autonomy_settings', autonomySettings],
  ['care_templates', careTemplates],
  ['care_enrollments', careEnrollments],
  ['care_messages', careMessages],
  ['care_usage', careUsage],
];

describe('care agent migration', () => {
  it('exists once', () => {
    expect(migrations).toHaveLength(1);
  });

  it('enables and forces RLS with tenant and system policies on every new table', () => {
    const text = sqlText();
    for (const [name, table] of tables) {
      expect(text).toContain(`create table ${name} (`);
      expect(text).toContain(`alter table ${name} enable row level security;`);
      expect(text).toContain(`alter table ${name} force row level security;`);
      expect(text).toContain(`create policy ${name}_tenant on ${name}`);
      expect(text).toContain(`create policy ${name}_system on ${name}`);
      const config = getTableConfig(table);
      expect(config.name).toBe(name);
      expect(config.policies.map((p) => p.name).sort()).toEqual([
        `${name}_system`,
        `${name}_tenant`,
      ]);
      expect(config.columns.map((c) => c.name)).toContain('workspace_id');
    }
  });

  it('keeps the outbox position in a global app_system table', () => {
    const text = sqlText();
    expect(text).toContain('create table care_checkpoints (');
    expect(text).toContain('revoke all on care_checkpoints from app_tenant;');
    expect(text).not.toContain('alter table care_checkpoints enable row level security');
    expect(getTableConfig(careCheckpoints).columns.map((c) => c.name)).toEqual([
      'consumer',
      'horizon',
      'updated_at',
    ]);
  });

  it('adds the opt-out signal as a column with a default (additive)', () => {
    expect(sqlText()).toContain(
      'alter table conversation_signals add column opt_out boolean not null default false;',
    );
    expect(getTableConfig(conversationSignals).columns.map((c) => c.name)).toContain('opt_out');
  });

  it('mirrors the indexes and checks of the migration', () => {
    const text = sqlText();
    const expected: [PgTable, string[]][] = [
      [
        careEnrollments,
        [
          'care_enrollments_conversation_template_idx',
          'care_enrollments_due_idx',
          'care_enrollments_after_sale_idx',
        ],
      ],
      [
        careMessages,
        [
          'care_messages_conversation_idx',
          'care_messages_draft_idx',
          'care_messages_sent_idx',
          'care_messages_open_idx',
        ],
      ],
    ];
    for (const [table, names] of expected) {
      expect(getTableConfig(table).indexes.map((i) => i.config.name)).toEqual(
        expect.arrayContaining(names),
      );
      for (const name of names)
        expect(text).toMatch(new RegExp(`create (unique )?index ${name} on`));
    }
    const checks = (t: PgTable) => getTableConfig(t).checks.map((c) => c.name);
    expect(checks(careMessages)).toEqual(
      expect.arrayContaining(['care_messages_status_check', 'care_messages_level_check']),
    );
    expect(checks(autonomySettings)).toEqual(
      expect.arrayContaining(['autonomy_settings_action_check', 'autonomy_settings_level_check']),
    );
    for (const name of [...checks(careMessages), ...checks(careEnrollments)]) {
      expect(text).toContain(`constraint ${name}`);
    }
  });
});
