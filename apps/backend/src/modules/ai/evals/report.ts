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
  /** True when every critical case passed (the release gate, docs/13 §2.3). */
  gate: boolean;
}

export function buildReport(
  mode: 'fake' | 'live',
  results: CaseResult[],
  promptVersion = 'sales-agent@9',
  startedAt = new Date().toISOString(),
): EvalReport {
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
    gate: criticalPassed === critical.length,
  };
}

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' / ');

function caseLines(r: CaseResult): string[] {
  const head = `${r.pass ? 'PASS' : 'FAIL'} ${r.id}${r.critical ? ' [critical]' : ''}`;
  if (r.pass) return [head];
  const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
  return [
    head,
    ...(r.error ? [`  error: ${r.error}`] : failed.map((f) => `  failed ${f}`)),
    `  customer: ${oneLine(r.customer)}`,
    `  reply: ${oneLine(r.reply)}${r.guardrail ? `  (guardrail ${r.guardrail})` : ''}`,
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
    `Critical: ${report.critical.passed}/${report.critical.total} ${report.gate ? 'OK' : 'GATE FAILED'}`,
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
    return `| ${r.pass ? 'PASS' : 'FAIL'} | ${r.id}${r.critical ? ' (critical)' : ''} | ${cell(failed)} | ${cell(r.reply)} |`;
  });
  return [
    `# Prompt evals: ${report.promptVersion} (${report.mode} mode)`,
    '',
    `Run at ${report.startedAt}.`,
    '',
    `**Critical: ${report.critical.passed}/${report.critical.total} ${report.gate ? 'OK' : 'GATE FAILED'}** · Total: ${report.passed}/${report.total}`,
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
