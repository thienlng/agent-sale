import type { ReadinessResponse } from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { READINESS_PROBES, type ReadinessProbe } from './ports/readiness-probe.js';

/** Ready only when every configured dependency is up; skipped probes do not count. */
@Injectable()
export class CheckReadiness {
  constructor(@Inject(READINESS_PROBES) private readonly probes: ReadinessProbe[]) {}

  async execute(timeoutMs = 1_000): Promise<ReadinessResponse> {
    const checks = await Promise.all(this.probes.map((p) => p.check(timeoutMs)));
    return { status: checks.some((c) => c.status === 'down') ? 'not_ready' : 'ready', checks };
  }
}
