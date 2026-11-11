import type { Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { BrainExportSource } from '../infrastructure/export/brain.export.js';

const ws = newId();

describe('BrainExportSource', () => {
  it('exports nothing without a database', () => {
    expect(new BrainExportSource(null).exportTables(ws)).toEqual([]);
  });

  it('declares conversation_signals.csv keyed by conversation, with unique snake_case headers', () => {
    // exportTable only touches the database when rows() is iterated.
    const tables = new BrainExportSource({} as Database).exportTables(ws);
    expect(tables.map((t) => t.file)).toEqual(['conversation_signals.csv']);
    const [t] = tables;
    expect(t?.columns[0]).toBe('conversation_id');
    expect(new Set(t?.columns).size).toBe(t?.columns.length);
    for (const c of t?.columns ?? []) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(t?.columns).toEqual(expect.arrayContaining(['customer_id', 'stage', 'mood', 'note']));
    expect(t?.columns).not.toContain('version');
  });
});
