import { readdirSync } from 'node:fs';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../migrate.js';
import { contacts } from './crm.js';

const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f));
const names = (cols: unknown[]) => cols.map((c) => (c as { name?: string }).name);

describe('contact link migration (PMS PR 3)', () => {
  it('is 0051 and no other migration uses the number', () => {
    expect(migrations.filter((f) => f.startsWith('0051_'))).toEqual([
      '0051_contacts_external_link.sql',
    ]);
  });

  it('declares the contacts constraints and indexes the migration adds', () => {
    const config = getTableConfig(contacts);
    expect(config.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'contacts_external_link_check',
        'contacts_external_push_state_check',
      ]),
    );
    const indexes = new Map(config.indexes.map((i) => [i.config.name, i.config]));
    expect(indexes.get('contacts_external')?.unique).toBe(true);
    expect(names(indexes.get('contacts_external')?.columns ?? [])).toEqual([
      'workspace_id',
      'external_source',
      'external_id',
    ]);
    expect(names(indexes.get('contacts_push_unclaimed_idx')?.columns ?? [])).toEqual([
      'workspace_id',
      'created_at',
    ]);
    expect(names(indexes.get('contacts_push_pending_idx')?.columns ?? [])).toEqual([
      'workspace_id',
      'external_push_at',
    ]);
  });
});
