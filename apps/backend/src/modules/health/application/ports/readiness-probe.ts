import type { ProbeResult } from '@agent-sales/contracts';

/** A dependency check used by GET /health/ready. Must answer within `timeoutMs`. */
export interface ReadinessProbe {
  readonly name: string;
  check(timeoutMs: number): Promise<ProbeResult>;
}

/** Multi-provider token: every infrastructure probe is registered under it. */
export const READINESS_PROBES = Symbol('READINESS_PROBES');
