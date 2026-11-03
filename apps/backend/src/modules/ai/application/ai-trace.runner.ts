import { Inject, Injectable } from '@nestjs/common';

import type { AiTraceRunner } from '../api/ai-trace-runner.js';
import {
  TURN_TRACE_REPOSITORY,
  type TurnTraceRepository,
} from '../domain/ports/turn-trace.repository.js';
import { TRACE_RETENTION_DAYS } from './turn-trace.service.js';

export const TRACE_PURGE_BATCH = 5_000;
export const TRACE_PURGE_MAX_BATCHES = 20;
const DAY_MS = 86_400_000;

/** The 30-day purge of shop-bot turn traces (spec §4.1). */
@Injectable()
export class AiTraceRunnerImpl implements AiTraceRunner {
  constructor(@Inject(TURN_TRACE_REPOSITORY) private readonly traces: TurnTraceRepository) {}

  async purgeExpired(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - TRACE_RETENTION_DAYS * DAY_MS);
    let total = 0;
    for (let batch = 0; batch < TRACE_PURGE_MAX_BATCHES; batch++) {
      const deleted = await this.traces.purgeExpired(before, TRACE_PURGE_BATCH);
      total += deleted;
      if (deleted < TRACE_PURGE_BATCH) break;
    }
    return total;
  }
}
