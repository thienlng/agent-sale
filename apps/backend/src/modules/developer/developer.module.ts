import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { BILLING_FACADE, type BillingFacade } from '../billing/api/index.js';
import { BillingModule } from '../billing/billing.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { DEVELOPER_RUNNER } from './api/developer.runner.js';
import { BillingDeveloperPlanGate } from './application/developer-plan-gate.js';
import { WebhookRunner } from './application/developer.runner.js';
import { DEVELOPER_STORE, DEVELOPER_SYSTEM_STORE } from './application/ports/developer-store.js';
import { DEVELOPER_PLAN_GATE, WEBHOOK_TRANSPORT } from './application/ports/webhook-transport.js';
import { WebhookDispatcher } from './application/webhook-dispatcher.js';
import { WebhookEndpointService } from './application/webhook-endpoint.service.js';
import { WebhookSender } from './application/webhook-sender.js';
import { HttpsWebhookTransport } from './infrastructure/clients/https-webhook-transport.js';
import {
  DrizzleDeveloperStore,
  DrizzleDeveloperSystemStore,
} from './infrastructure/persistence/developer.drizzle-store.js';
import { InMemoryDeveloperStore } from './infrastructure/persistence/developer.in-memory-store.js';
import { DeveloperController } from './interface/http/developer.controller.js';

/** One in-memory store backs both ports when there is no database (dev runs, specs). */
const IN_MEMORY = Symbol('DEVELOPER_IN_MEMORY');

/**
 * Public API management and outbound webhooks (ADR-022): Settings → Developers, and the worker's
 * webhook dispatcher and sender. API keys are owned by `identity` (served here via its facade).
 */
@Module({
  imports: [IdentityModule, BillingModule],
  controllers: [DeveloperController],
  providers: [
    { provide: IN_MEMORY, useFactory: () => new InMemoryDeveloperStore() },
    {
      provide: DEVELOPER_STORE,
      inject: [{ token: DB_TENANT, optional: true }, IN_MEMORY],
      useFactory: (db: Database | null | undefined, memory: InMemoryDeveloperStore) =>
        db ? new DrizzleDeveloperStore(db) : memory,
    },
    {
      provide: DEVELOPER_SYSTEM_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }, IN_MEMORY],
      useFactory: (db: Database | null | undefined, memory: InMemoryDeveloperStore) =>
        db ? new DrizzleDeveloperSystemStore(db) : memory,
    },
    { provide: WEBHOOK_TRANSPORT, useFactory: () => new HttpsWebhookTransport() },
    {
      provide: DEVELOPER_PLAN_GATE,
      inject: [BILLING_FACADE],
      useFactory: (billing: BillingFacade) => new BillingDeveloperPlanGate(billing),
    },
    {
      provide: SECRET_BOX,
      useFactory: () =>
        getEnv().SECRETS_ENCRYPTION_KEY
          ? SecretBox.fromBase64(getEnv().SECRETS_ENCRYPTION_KEY ?? '')
          : SecretBox.insecureDevelopmentBox(),
    },
    WebhookEndpointService,
    WebhookDispatcher,
    WebhookSender,
    WebhookRunner,
    { provide: DEVELOPER_RUNNER, useExisting: WebhookRunner },
  ],
  exports: [DEVELOPER_RUNNER],
})
export class DeveloperModule {}
