import type { CaseResult } from './runner.js';

export interface GroupSummary {
  group: string;
  passed: number;
  total: number;
}

/** Cost and speed of a run, over every run of every case (repeats included). */
export interface RunStats {
  /** Distinct `provider/model` that answered, sorted. */
  models: string[];
  runs: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface EvalReport {
  mode: 'fake' | 'live';
  promptVersion: string;
  /** Runs per case (`--repeat`, 1 by default). A case passes only when every run passed. */
  repeat: number;
  stats: RunStats;
  /** Cases that passed some runs and failed others. */
  flaky: string[];
  /**
   * Cases with a run that ended in an error (provider unavailable, usage limit…) instead of a reply:
   * not the model's answer, so rerun them before reading the score.
   */
  errored: string[];
  startedAt: string;
  results: CaseResult[];
  groups: GroupSummary[];
  critical: { passed: number; total: number };
  passed: number;
  total: number;
  /** Release gate (docs/13 §2.3): `none` when no critical case ran, so nothing was gated. */
  gate: 'pass' | 'fail' | 'none';
}

function criticalLine(report: EvalReport): string {
  if (report.gate === 'none') return 'No critical cases ran (gate not evaluated)';
  return `Critical: ${report.critical.passed}/${report.critical.total} ${report.gate === 'pass' ? 'OK' : 'GATE FAILED'}`;
}

/** Nearest-rank percentile of the values; `null` when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

/**
 * Folds the runs of each case into one result: it passes only when every run passed, and it shows
 * the first failing run (the last run when all passed), with `repeats` counting the passing runs.
 */
export function mergeRepeats(runsPerCase: readonly (readonly CaseResult[])[]): CaseResult[] {
  return runsPerCase.flatMap((runs) => {
    const failed = runs.find((r) => !r.pass);
    const shown = failed ?? runs.at(-1);
    if (!shown) return [];
    if (runs.length === 1) return [shown];
    return [
      {
        ...shown,
        pass: !failed,
        repeats: { passed: runs.filter((r) => r.pass).length, total: runs.length },
      },
    ];
  });
}

export function runStats(runs: readonly CaseResult[]): RunStats {
  const models = new Set(runs.flatMap((r) => (r.model ? [`${r.provider ?? '?'}/${r.model}`] : [])));
  const latencies = runs.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
  const sum = (pick: (r: CaseResult) => number) => runs.reduce((n, r) => n + pick(r), 0);
  return {
    models: [...models].sort(),
    runs: runs.length,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    modelCalls: sum((r) => r.modelCalls),
    inputTokens: sum((r) => r.inputTokens),
    outputTokens: sum((r) => r.outputTokens),
  };
}

/**
 * `results` holds one result per case (see `mergeRepeats`); `runs` every single run, for the cost
 * and speed figures (the same list without repeats).
 */
export function buildReport(
  mode: 'fake' | 'live',
  results: CaseResult[],
  startedAt = new Date().toISOString(),
  runs: readonly CaseResult[] = results,
): EvalReport {
  const promptVersion =
    [...new Set(results.map((r) => r.promptVersion).filter((v): v is string => Boolean(v)))]
      .sort()
      .join(', ') || 'unknown';
  const byGroup = new Map<string, GroupSummary>();
  for (const r of results) {
    const g = byGroup.get(r.group) ?? { group: r.group, passed: 0, total: 0 };
    g.total += 1;
    if (r.pass) g.passed += 1;
    byGroup.set(r.group, g);
  }
  const critical = results.filter((r) => r.critical);
  const criticalPassed = critical.filter((r) => r.pass).length;
  return {
    mode,
    promptVersion,
    repeat: Math.max(1, ...results.map((r) => r.repeats?.total ?? 1)),
    stats: runStats(runs),
    errored: results.filter((r) => r.error !== null).map((r) => r.id),
    flaky: results
      .filter((r) => r.repeats && r.repeats.passed > 0 && r.repeats.passed < r.repeats.total)
      .map((r) => r.id),
    startedAt,
    results,
    groups: [...byGroup.values()],
    critical: { passed: criticalPassed, total: critical.length },
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    gate: critical.length === 0 ? 'none' : criticalPassed === critical.length ? 'pass' : 'fail',
  };
}

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' / ');

const runsOf = (r: CaseResult): string =>
  r.repeats ? ` (${r.repeats.passed}/${r.repeats.total} runs)` : '';

function statsLines(report: EvalReport): string[] {
  const s = report.stats;
  const ms = (v: number | null) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`);
  return [
    `Model: ${s.models.join(', ') || 'none'} · ${report.repeat} run(s) per case`,
    `Latency per turn: P50 ${ms(s.latencyP50Ms)}, P95 ${ms(s.latencyP95Ms)} · ${s.modelCalls} model calls · tokens in ${s.inputTokens}, out ${s.outputTokens}`,
    ...(report.flaky.length ? [`Flaky (mixed results): ${report.flaky.join(', ')}`] : []),
    ...(report.errored.length
      ? [
          `Errored, not graded (rerun with --id): ${report.errored.length} case(s): ${report.errored.join(',')}`,
        ]
      : []),
  ];
}

function caseLines(r: CaseResult): string[] {
  const via = r.guardrail ? `  (guardrail fired: ${r.guardrail})` : '';
  const head = `${r.pass ? 'PASS' : 'FAIL'} ${r.id}${r.critical ? ' [critical]' : ''}${runsOf(r)}${r.pass ? via : ''}`;
  if (r.pass) return [head];
  const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
  return [
    head,
    ...(r.error ? [`  error: ${r.error}`] : failed.map((f) => `  failed ${f}`)),
    `  customer: ${oneLine(r.customer)}`,
    `  reply: ${oneLine(r.reply)}${r.guardrail ? `  (guardrail ${r.guardrail})` : ''}`,
    `  delivered: ${r.messages} messages, ${r.images} pictures`,
  ];
}

/** Plain text for the terminal: one line per case, details only for failures. */
export function renderText(report: EvalReport): string {
  const lines = report.results.flatMap(caseLines);
  const table = report.groups.map((g) => `  ${g.group.padEnd(24)} ${g.passed}/${g.total}`);
  return [
    `Prompt evals (${report.mode} mode, ${report.promptVersion})`,
    '',
    ...lines,
    '',
    'Groups',
    ...table,
    '',
    criticalLine(report),
    `Total: ${report.passed}/${report.total}`,
    ...statsLines(report),
  ].join('\n');
}

const cell = (text: string): string => oneLine(text).replace(/\|/g, '\\|');

/** The Markdown report written next to the JSON: every case with its reply, then the group table. */
export function renderMarkdown(report: EvalReport): string {
  const rows = report.results.map((r) => {
    const failed = r.error
      ? `error: ${r.error}`
      : r.checks
          .filter((c) => !c.pass)
          .map((c) => `${c.name}: ${c.detail}`)
          .join('; ');
    const status =
      r.pass && r.guardrail ? `PASS via guardrail: ${r.guardrail}` : r.pass ? 'PASS' : 'FAIL';
    return `| ${status}${runsOf(r)} | ${r.id}${r.critical ? ' (critical)' : ''} | ${cell(failed)} | ${cell(r.reply)} |`;
  });
  return [
    `# Prompt evals: ${report.promptVersion} (${report.mode} mode)`,
    '',
    `Run at ${report.startedAt}.`,
    '',
    `**${criticalLine(report)}** · Total: ${report.passed}/${report.total}`,
    '',
    ...statsLines(report).map((l) => `- ${l}`),
    '',
    '| Group | Passed | Total |',
    '| --- | --- | --- |',
    ...report.groups.map((g) => `| ${g.group} | ${g.passed} | ${g.total} |`),
    '',
    '## Cases',
    '',
    '| Result | Case | Failed check | Reply |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
