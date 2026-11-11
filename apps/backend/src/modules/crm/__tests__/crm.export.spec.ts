import type { Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { CrmExportSource } from '../infrastructure/export/crm.export.js';

const ws = newId();

describe('CrmExportSource', () => {
  it('exports nothing without a database', () => {
    expect(new CrmExportSource(null).exportTables(ws)).toEqual([]);
  });

  it('declares its files, tasks included, with unique snake_case headers', () => {
    // exportTable only touches the database when rows() is iterated.
    const tables = new CrmExportSource({} as Database).exportTables(ws);
    expect(tables.map((t) => t.file)).toEqual([
      'customers.csv',
      'customer_notes.csv',
      'customer_history.csv',
      'customer_tags.csv',
      'tasks.csv',
    ]);
    for (const t of tables) {
      expect(new Set(t.columns).size).toBe(t.columns.length);
      for (const c of t.columns) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.columns[0]).toBe('id');
    }
    const tasks = tables.find((t) => t.file === 'tasks.csv');
    expect(tasks?.columns).toEqual(
      expect.arrayContaining(['title', 'status', 'due_at', 'customer_id', 'conversation_id']),
    );
    expect(tasks?.columns).not.toContain('version');
  });
});
