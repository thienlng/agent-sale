import { SaasSubscriptionChangedV1 } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { SubscriptionRecord } from '../application/ports/saas-store.js';
import { subscriptionChanged } from '../application/subscription-events.js';

const ws = workspaceId('00000000-0000-4000-8000-000000000001');
const at = '2026-11-02T03:00:00.000Z';
const row: SubscriptionRecord = {
  id: '00000000-0000-4000-8000-0000000000a1',
  contactId: '00000000-0000-4000-8000-0000000000c1',
  planName: 'Pro',
  stage: 'trial',
  billingPeriod: 'monthly',
  mrr: 0,
  planId: null,
  seats: null,
  trialEndsOn: '2026-11-10',
  startedOn: null,
  renewsOn: null,
  canceledOn: null,
  externalRef: null,
  note: '',
  churnReason: null,
  churnNote: '',
  externalSource: null,
  usage: null,
  remindersSent: {},
  version: 1,
  createdAt: at,
  updatedAt: at,
};

describe('subscriptionChanged', () => {
  it('reports a new subscription with no previous stage, as a valid v1 payload', () => {
    const payload = subscriptionChanged(ws, null, row, null, at);
    expect(payload).toMatchObject({ subscriptionId: row.id, stage: 'trial', fromStage: null });
    expect(() =>
      SaasSubscriptionChangedV1.parse({ type: 'saas.subscription.changed.v1', ...payload }),
    ).not.toThrow();
  });

  it('reports a change of stage, plan, period, MRR or a date', () => {
    const changes: Array<Partial<SubscriptionRecord>> = [
      { stage: 'active' },
      { planName: 'Neo' },
      { billingPeriod: 'yearly' },
      { mrr: 990_000 },
      { trialEndsOn: '2026-11-20' },
      { renewsOn: '2026-12-01' },
      { canceledOn: '2026-11-05' },
    ];
    for (const change of changes) {
      expect(subscriptionChanged(ws, row, { ...row, ...change }, 'u', at)).toMatchObject({
        ...change,
        fromStage: 'trial',
        actorUserId: 'u',
      });
    }
  });

  it('stays quiet when only the note, seats, usage or reminders changed', () => {
    const after: SubscriptionRecord = {
      ...row,
      note: 'Called',
      seats: 3,
      usage: { used: 10, limit: 100, at },
      remindersSent: { 'trial:2026-11-10': at },
      version: 2,
    };
    expect(subscriptionChanged(ws, row, after, null, at)).toBeNull();
  });
});
