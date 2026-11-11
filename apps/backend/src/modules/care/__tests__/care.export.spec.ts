import type { Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { CareExportSource } from '../infrastructure/export/care.export.js';

describe('CareExportSource', () => {
  it('exports nothing without a database', () => {
    expect(new CareExportSource(null).exportTables(newId())).toEqual([]);
  });

  it('declares care_messages.csv and care_enrollments.csv (not the usage), snake_case headers', () => {
    // exportTable only touches the database when rows() is iterated.
    const tables = new CareExportSource({} as Database).exportTables(newId());
    expect(tables.map((t) => t.file)).toEqual(['care_messages.csv', 'care_enrollments.csv']);
    for (const t of tables) {
      expect(t.columns[0]).toBe('id');
      expect(new Set(t.columns).size).toBe(t.columns.length);
      for (const c of t.columns) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(tables[0]?.columns).toEqual(
      expect.arrayContaining(['conversation_id', 'status', 'text', 'level', 'decided_by']),
    );
  });
});
