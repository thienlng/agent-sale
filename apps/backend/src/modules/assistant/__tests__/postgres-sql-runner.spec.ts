import type * as db from '@agent-sales/db';
import { AssistantSqlError, type AssistantSqlClient } from '@agent-sales/db';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SqlRunError } from '../domain/ports/sql-runner.port.js';
import { PostgresSqlRunner } from '../infrastructure/sql/postgres-sql-runner.js';

const runAssistantSql = vi.hoisted(() => vi.fn());
vi.mock('@agent-sales/db', async (importOriginal) => ({
  ...(await importOriginal<typeof db>()),
  runAssistantSql,
}));

const client = {} as AssistantSqlClient;
const scope = { accountId: 'acc', businessIds: ['b1'] };
const runner = new PostgresSqlRunner(client);

async function errorOf(p: Promise<unknown>): Promise<SqlRunError> {
  const e: unknown = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(SqlRunError);
  return e as SqlRunError;
}

describe('PostgresSqlRunner', () => {
  beforeEach(() => {
    runAssistantSql.mockReset();
  });

  it('guards the text again and never reaches the database with a rejected query', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const secret = "select * from users where name = 'secret-text'";
    const e = await errorOf(runner.run({ ...scope, sql: secret }));
    expect(e.sqlstate).toBe('42501');
    expect(e.message).toBe('rejected by the SQL guard: unknown_view:users');
    expect(runAssistantSql).not.toHaveBeenCalled();
    // Logged with a fingerprint only, never the text.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/sql=[0-9a-f]{12} len=\d+/);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('secret');
    warn.mockRestore();
  });

  it('runs the guarded text with the scope', async () => {
    const result = { columns: [{ name: 'n', type: 'number' }], rows: [[1]], truncated: false };
    runAssistantSql.mockResolvedValue(result);
    await expect(
      runner.run({ ...scope, sql: ' select count(*) as n from orders ; ' }),
    ).resolves.toBe(result);
    expect(runAssistantSql).toHaveBeenCalledWith(client, {
      accountId: 'acc',
      businessIds: ['b1'],
      sql: 'select count(*) as n from orders',
    });
  });

  it('maps Postgres errors to their SQL state', async () => {
    runAssistantSql.mockRejectedValue(new AssistantSqlError('57014', 'canceling statement'));
    const e = await errorOf(runner.run({ ...scope, sql: 'select 1 from orders' }));
    expect([e.sqlstate, e.message]).toEqual(['57014', 'canceling statement']);
  });

  it('maps connection failures (class 08, or no SQL state) to 08000 unavailable', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    runAssistantSql.mockRejectedValueOnce(new AssistantSqlError('08006', 'connection failure'));
    runAssistantSql.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    for (let i = 0; i < 2; i++) {
      const e = await errorOf(runner.run({ ...scope, sql: 'select 1 from orders' }));
      expect([e.sqlstate, e.message]).toEqual(['08000', 'unavailable']);
    }
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain('select');
    warn.mockRestore();
  });
});
