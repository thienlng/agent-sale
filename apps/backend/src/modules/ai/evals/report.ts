import type { CaseResult } from './runner.js';

export interface GroupSummary {
  group: string;
  passed: number;
  total: number;
}

export interface EvalReport {
  mode: 'fake' | 'live';
  promptVersion: string;
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

export function buildReport(
  mode: 'fake' | 'live',
  results: CaseResult[],
  startedAt = new Date().toISOString(),
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

function caseLines(r: CaseResult): string[] {
  const via = r.guardrail ? `  (guardrail fired: ${r.guardrail})` : '';
  const head = `${r.pass ? 'PASS' : 'FAIL'} ${r.id}${r.critical ? ' [critical]' : ''}${r.pass ? via : ''}`;
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
    return `| ${status} | ${r.id}${r.critical ? ' (critical)' : ''} | ${cell(failed)} | ${cell(r.reply)} |`;
  });
  return [
    `# Prompt evals: ${report.promptVersion} (${report.mode} mode)`,
    '',
    `Run at ${report.startedAt}.`,
    '',
    `**${criticalLine(report)}** · Total: ${report.passed}/${report.total}`,
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
