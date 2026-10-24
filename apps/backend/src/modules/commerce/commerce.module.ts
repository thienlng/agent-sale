import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { COMMERCE_FACADE } from './api/commerce.facade.js';
import { CatalogService } from './application/catalog.service.js';
import { OrderService } from './application/order.service.js';
import { COMMERCE_STORE } from './application/ports/commerce-store.js';
import { DrizzleCommerceStore } from './infrastructure/persistence/commerce.drizzle-store.js';
import { UnavailableCommerceStore } from './infrastructure/persistence/unavailable-store.js';
import { CatalogController } from './interface/http/catalog.controller.js';
import { OrdersController } from './interface/http/orders.controller.js';

/** Products, warehouses, inventory and orders (docs/02 ORD-*). Needs a database. */
@Module({
  imports: [IdentityModule, WorkspaceModule],
  controllers: [CatalogController, OrdersController],
  providers: [
    {
      provide: COMMERCE_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleCommerceStore(db) : new UnavailableCommerceStore(),
    },
    CatalogService,
    OrderService,
    { provide: COMMERCE_FACADE, useExisting: OrderService },
  ],
  exports: [COMMERCE_FACADE],
})
export class CommerceModule {}
