import type { Database } from '@agent-sales/db';
import { describe, expect, it } from 'vitest';

import { WorkspaceDataExportSource } from '../infrastructure/export/workspace.export.js';

const WS = '01890000-0000-7000-8000-000000000001';

describe('WorkspaceDataExportSource', () => {
  it('exports nothing without a database', () => {
    expect(new WorkspaceDataExportSource(null).exportTables(WS)).toEqual([]);
  });

  it('declares its files with unique snake_case headers', () => {
    // exportTable does not touch the database until rows() is iterated.
    const tables = new WorkspaceDataExportSource({} as Database).exportTables(WS);
    expect(tables.map((t) => t.file)).toEqual(['business.csv', 'members.csv']);
    for (const t of tables) {
      expect(new Set(t.columns).size).toBe(t.columns.length);
      for (const c of t.columns) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.columns[0]).toBe('id');
      for (const m of t.mediaColumns ?? []) expect(t.columns).toContain(m);
    }
  });
});
