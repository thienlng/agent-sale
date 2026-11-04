import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../migrate.js';
import { assistantSchedules } from './assistant.js';
import { products } from './commerce.js';
import { contactHistory } from './crm.js';

const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f));

describe('service verticals migration (T-187)', () => {
  it('is 0064 and no other migration uses the number', () => {
    expect(migrations.filter((f) => f.startsWith('0064_'))).toEqual(['0064_service_verticals.sql']);
  });

  it('declares what the migration adds', () => {
    const p = getTableConfig(products);
    expect(p.columns.map((c) => c.name)).toContain('offering');
    expect(p.checks.map((c) => c.name)).toContain('products_offering_or_accommodation');
    expect(getTableConfig(contactHistory).indexes.map((i) => i.config.name)).toContain(
      'contact_history_requests_idx',
    );
  });

  it('allows the new_requests template in the migration and the schema', () => {
    const file = readFileSync(join(MIGRATIONS_DIR, '0064_service_verticals.sql'), 'utf8');
    expect(file.match(/'new_requests'/g)).toHaveLength(2);
    const chunks = (v: unknown): string =>
      ((v as { queryChunks?: unknown[] }).queryChunks ?? [])
        .map((q) => ((q as { value?: unknown }).value as string[] | undefined)?.join('') ?? '')
        .join('');
    const checks = getTableConfig(assistantSchedules).checks.filter((c) =>
      chunks(c.value).includes("'new_requests'"),
    );
    expect(checks.map((c) => c.name).sort()).toEqual([
      'assistant_schedules_mode_template_check',
      'assistant_schedules_template_check',
    ]);
  });
});
