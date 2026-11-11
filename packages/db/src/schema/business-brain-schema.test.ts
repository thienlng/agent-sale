import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../migrate.js';
import {
  brainCheckpoints,
  brainSettings,
  conversationSignals,
  signalJobs,
  signalRuns,
  signalUsage,
} from './brain.js';
import { tasks } from './crm.js';

// Found by its name, not its number: the number may change when it is rebased onto main.
const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_business_brain\.sql$/.test(f));
const FILE = migrations[0] ?? '';

const tables: [string, PgTable][] = [
  ['conversation_signals', conversationSignals],
  ['signal_jobs', signalJobs],
  ['signal_runs', signalRuns],
  ['signal_usage', signalUsage],
  ['brain_settings', brainSettings],
  ['tasks', tasks],
];

describe('business brain migration', () => {
  it('exists once', () => {
    expect(migrations).toHaveLength(1);
  });

  it('keeps the outbox position in its own global table (app_system only, no RLS)', () => {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8').toLowerCase();
    expect(sqlText).toContain('create table brain_checkpoints (');
    expect(sqlText).toContain('revoke all on brain_checkpoints from app_tenant;');
    expect(sqlText).toContain(
      'grant select, insert, update, delete on brain_checkpoints to app_system;',
    );
    expect(sqlText).not.toContain('alter table brain_checkpoints enable row level security');
    expect(getTableConfig(brainCheckpoints).columns.map((c) => c.name)).toEqual([
      'consumer',
      'horizon',
      'updated_at',
    ]);
  });

  it('enables and forces RLS with tenant and system policies on every new table', () => {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8').toLowerCase();
    for (const [name, table] of tables) {
      expect(sqlText).toContain(`create table ${name} (`);
      expect(sqlText).toContain(`alter table ${name} enable row level security;`);
      expect(sqlText).toContain(`alter table ${name} force row level security;`);
      expect(sqlText).toContain(`create policy ${name}_tenant on ${name}`);
      expect(sqlText).toContain(`create policy ${name}_system on ${name}`);
      const config = getTableConfig(table);
      expect(config.name).toBe(name);
      expect(config.policies.map((p) => p.name).sort()).toEqual([
        `${name}_system`,
        `${name}_tenant`,
      ]);
      expect(config.columns.map((c) => c.name)).toContain('workspace_id');
    }
  });

  it('mirrors the indexes of the migration', () => {
    const indexes = (t: PgTable) => getTableConfig(t).indexes.map((i) => i.config.name);
    const sqlText = readFileSync(join(MIGRATIONS_DIR, FILE), 'utf8').toLowerCase();
    const expected: [PgTable, string[]][] = [
      [
        tasks,
        [
          'tasks_status_due_idx',
          'tasks_open_assignee_idx',
          'tasks_contact_idx',
          'tasks_conversation_idx',
          'tasks_reminder_due_idx',
        ],
      ],
      [signalJobs, ['signal_jobs_due_idx', 'signal_jobs_capped_idx']],
      [
        conversationSignals,
        [
          'conversation_signals_stage_idx',
          'conversation_signals_follow_up_idx',
          'conversation_signals_contact_idx',
        ],
      ],
    ];
    for (const [table, names] of expected) {
      expect(indexes(table)).toEqual(expect.arrayContaining(names));
      for (const name of names) expect(sqlText).toContain(`create index ${name} on`);
    }
  });

  it('mirrors the enum and length checks', () => {
    const checks = (t: PgTable) => getTableConfig(t).checks.map((c) => c.name);
    expect(checks(conversationSignals)).toEqual(
      expect.arrayContaining([
        'conversation_signals_stage_check',
        'conversation_signals_mood_check',
        'conversation_signals_intent_length',
        'conversation_signals_note_length',
      ]),
    );
    expect(checks(signalJobs)).toEqual(
      expect.arrayContaining(['signal_jobs_status_check', 'signal_jobs_trigger_check']),
    );
    expect(checks(signalRuns)).toEqual(
      expect.arrayContaining(['signal_runs_outcome_check', 'signal_runs_trigger_check']),
    );
    expect(checks(brainSettings)).toEqual(
      expect.arrayContaining(['brain_settings_mode_check', 'brain_settings_idle_minutes_check']),
    );
    expect(checks(tasks)).toEqual(
      expect.arrayContaining([
        'tasks_status_check',
        'tasks_source_check',
        'tasks_assignee_kind_check',
        'tasks_title_length',
        'tasks_note_length',
        'tasks_done_at_check',
      ]),
    );
  });
});
