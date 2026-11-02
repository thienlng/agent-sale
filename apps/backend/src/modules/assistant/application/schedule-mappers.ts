import type { ScheduleDto, ScheduleRunDto } from '@agent-sales/contracts';

import type { ScheduleRecord, ScheduleRunRecord } from '../domain/ports/assistant.repository.js';

export type Delivery = Partial<Record<'email' | 'push', DeliveryState>>;
type DeliveryState = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export function toScheduleDto(
  s: ScheduleRecord,
  lastRun: ScheduleRunRecord | null,
  delivery: Delivery,
): ScheduleDto {
  return {
    id: s.id,
    name: s.name,
    businessId: s.businessId,
    template: s.template,
    mode: s.mode,
    params: s.params,
    cadence: s.cadence,
    channels: s.channels,
    commentary: s.commentary,
    status: s.status,
    pausedReason: s.pausedReason,
    nextRunAt: s.nextRunAt?.toISOString() ?? null,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          delivery,
        }
      : null,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toScheduleRunDto(r: ScheduleRunRecord, delivery: Delivery): ScheduleRunDto {
  return {
    id: r.id,
    scheduleId: r.scheduleId,
    trigger: r.trigger,
    scheduledFor: r.scheduledFor.toISOString(),
    status: r.status,
    errorCode: r.errorCode,
    title: r.title,
    body: r.body,
    threadId: r.threadId,
    delivery,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}
