import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../migrate.js';
import { orders } from './commerce.js';
import { integrationJobs } from './integration.js';

const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f));

describe('order push migration (PMS PR 2)', () => {
  it('has a number no other migration uses', () => {
    expect(migrations.filter((f) => f.startsWith('0050_'))).toEqual(['0050_order_push.sql']);
  });

  it('is 0050, clear of the lodging series (0041…0049)', () => {
    expect(migrations).toContain('0050_order_push.sql');
    expect(migrations.filter((f) => f.endsWith('_order_push.sql'))).toEqual([
      '0050_order_push.sql',
    ]);
  });

  it('keys the one-open-push-per-order index by workspace first', () => {
    const body = readFileSync(path.join(MIGRATIONS_DIR, '0050_order_push.sql'), 'utf8');
    expect(body).toMatch(
      /integration_jobs_one_push_per_order\s+on integration_jobs \(workspace_id, \(payload ->> 'orderId'\)\)/,
    );
    const index = getTableConfig(integrationJobs).indexes.find(
      (i) => i.config.name === 'integration_jobs_one_push_per_order',
    );
    expect(index?.config.columns).toHaveLength(2);
    expect((index?.config.columns[0] as { name?: string }).name).toBe('workspace_id');
  });

  it('declares the orders constraints and indexes the migration adds', () => {
    const config = getTableConfig(orders);
    expect(config.checks.map((c) => c.name)).toContain('orders_stock_state_check');
    const indexes = new Map(config.indexes.map((i) => [i.config.name, i.config]));
    expect(indexes.get('orders_external')?.unique).toBe(true);
    expect(
      indexes.get('orders_external')?.columns.map((c) => (c as { name?: string }).name),
    ).toEqual(['workspace_id', 'external_source', 'external_id']);
    expect(
      indexes.get('orders_push_unclaimed_idx')?.columns.map((c) => (c as { name?: string }).name),
    ).toEqual(['workspace_id', 'created_at']);
    expect(
      indexes.get('orders_push_pending_idx')?.columns.map((c) => (c as { name?: string }).name),
    ).toEqual(['workspace_id', 'updated_at']);
  });
});
