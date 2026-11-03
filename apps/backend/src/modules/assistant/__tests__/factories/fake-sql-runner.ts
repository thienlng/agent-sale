import type { SqlRunner, SqlRunResult } from '../../domain/ports/sql-runner.port.js';

type RunInput = Parameters<SqlRunner['run']>[0];

/** A SqlRunner for unit tests: records every call and answers with `respond`. */
export class FakeSqlRunner implements SqlRunner {
  readonly calls: RunInput[] = [];

  constructor(
    private readonly respond: (i: RunInput) => SqlRunResult | Promise<SqlRunResult> = () => ({
      columns: [{ name: 'n', type: 'number' }],
      rows: [[1]],
      truncated: false,
    }),
  ) {}

  run(i: RunInput): Promise<SqlRunResult> {
    this.calls.push({ ...i, businessIds: [...i.businessIds] });
    return Promise.resolve().then(() => this.respond(i));
  }
}
