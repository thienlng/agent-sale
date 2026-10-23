import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

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
