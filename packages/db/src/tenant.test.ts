import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { tenantContextSql } from './tenant.js';

describe('tenantContextSql', () => {
  it('uses a transaction-local set_config (never a session SET)', () => {
    const q = tenantContextSql(workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10'));
    const text = q.queryChunks
      .map((c) =>
        typeof c === 'object' && c !== null && 'value' in c
          ? String((c as { value: unknown }).value)
          : '',
      )
      .join('');
    expect(text).toContain("set_config('app.workspace_id'");
    expect(text).toContain(', true)');
    expect(text).not.toMatch(/\bSET\s+app\./i);
  });
});
