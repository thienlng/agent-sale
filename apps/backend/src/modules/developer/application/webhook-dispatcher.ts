import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  type DeliveryRecord,
  DEVELOPER_SYSTEM_STORE,
  type DeveloperSystemStore,
} from './ports/developer-store.js';
import { DEVELOPER_PLAN_GATE, type DeveloperPlanGate } from './ports/webhook-transport.js';
import { PUBLIC_SOURCE_TYPES, toPublicEnvelope } from './public-events.js';

const BATCH = 500;

/**
 * Turns public outbox events into pending deliveries, one per subscribed enabled endpoint
 * (ADR-022 §5). Reads the transaction-horizon window of the outbox under an exclusive lease, so
 * every committed event is dispatched once; the (endpoint, event id) key absorbs replays.
 */
@Injectable()
export class WebhookDispatcher {
  constructor(
    @Inject(DEVELOPER_SYSTEM_STORE) private readonly system: DeveloperSystemStore,
    @Inject(DEVELOPER_PLAN_GATE) private readonly plan: DeveloperPlanGate,
  ) {}

  /** Returns how many deliveries it queued; null when another worker holds the lease. */
  dispatch(now = new Date()): Promise<number | null> {
    return this.system.withDispatchLease(async (lease) => {
      let queued = 0;
      let afterId = 0;
      // The window ends at the horizon, so the loop ends; the position moves only when it is done.
      for (;;) {
        const rows = await lease.readBatch(PUBLIC_SOURCE_TYPES, afterId, BATCH);
        if (!rows.length) {
          await lease.commit();
          return queued;
        }
        afterId = rows.at(-1)?.id ?? afterId;
        const workspaces = [...new Set(rows.map((r) => r.workspaceId))];
        const endpoints = await lease.enabledEndpoints(workspaces);
        const entitled = new Set<WorkspaceId>();
        for (const ws of new Set(endpoints.map((x) => x.workspaceId))) {
          if (await this.plan.enabled(ws)) entitled.add(ws);
        }
        const deliveries: DeliveryRecord[] = [];
        for (const row of rows) {
          const subscribers = endpoints.filter((x) => x.workspaceId === row.workspaceId);
          if (!subscribers.length || !entitled.has(row.workspaceId)) continue;
          const envelope = toPublicEnvelope(row);
          if (!envelope) continue;
          for (const endpoint of subscribers) {
            if (!endpoint.events.includes(envelope.type)) continue;
            deliveries.push({
              id: newId(),
              workspaceId: row.workspaceId,
              endpointId: endpoint.id,
              eventId: envelope.id,
              eventType: envelope.type,
              payload: envelope,
              status: 'pending',
              attempts: 0,
              nextAttemptAt: now,
              lastStatusCode: null,
              lastError: null,
              deliveredAt: null,
              createdAt: now,
            });
          }
        }
        await lease.insertDeliveries(deliveries);
        queued += deliveries.length;
      }
    });
  }
}
