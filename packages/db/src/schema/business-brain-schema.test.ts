import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../migrate.js';
import {
  brainSettings,
  conversationSignals,
  signalJobs,
  signalRuns,
  signalUsage,
} from './brain.js';
import { tasks } from './crm.js';

const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f));
const FILE = '0072_business_brain.sql';

const tables: [string, PgTable][] = [
  ['conversation_signals', conversationSignals],
  ['signal_jobs', signalJobs],
  ['signal_runs', signalRuns],
  ['signal_usage', signalUsage],
  ['brain_settings', brainSettings],
  ['tasks', tasks],
];

describe('business brain migration (0072)', () => {
  it('is 0072 and no other migration uses the number', () => {
    expect(migrations.filter((f) => f.startsWith('0072_'))).toEqual([FILE]);
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
    expect(indexes(tasks)).toEqual(
      expect.arrayContaining(['tasks_status_due_idx', 'tasks_open_assignee_idx']),
    );
    expect(indexes(signalJobs)).toContain('signal_jobs_due_idx');
    expect(indexes(conversationSignals)).toEqual(
      expect.arrayContaining([
        'conversation_signals_stage_idx',
        'conversation_signals_follow_up_idx',
      ]),
    );
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
    expect(checks(signalRuns)).toContain('signal_runs_outcome_check');
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
      ]),
    );
  });
});
