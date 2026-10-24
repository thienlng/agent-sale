import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Process-wide Prometheus registry (docs/10 §4). Scraped at GET /metrics by the
 * self-hosted Prometheus/Mimir. Labels are low-cardinality on purpose: route
 * templates, never raw URLs or tenant ids.
 */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by route template and status',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const aiTokens = new Counter({
  name: 'ai_tokens_total',
  help: 'LLM tokens by provider, model and kind (input, output, cached)',
  labelNames: ['provider', 'model', 'kind'] as const,
  registers: [metricsRegistry],
});

export const aiRuns = new Counter({
  name: 'ai_runs_total',
  help: 'LLM turns by outcome (answered, fallback, handoff) and whether they were tests',
  labelNames: ['outcome', 'test'] as const,
  registers: [metricsRegistry],
});

export const aiLatency = new Histogram({
  name: 'ai_run_duration_seconds',
  help: 'LLM call latency by provider',
  labelNames: ['provider'] as const,
  buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 20],
  registers: [metricsRegistry],
});

/** Low-cardinality AI metrics; per-tenant numbers live in ai_runs, not in Prometheus. */
export function recordAiRun(run: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  outcome: string;
  isTest: boolean;
}): void {
  const labels = { provider: run.provider, model: run.model };
  aiTokens.inc({ ...labels, kind: 'input' }, run.inputTokens);
  aiTokens.inc({ ...labels, kind: 'output' }, run.outputTokens);
  aiTokens.inc({ ...labels, kind: 'cached' }, run.cachedTokens);
  aiRuns.inc({ outcome: run.outcome, test: String(run.isTest) });
  aiLatency.observe({ provider: run.provider }, run.latencyMs / 1000);
}
