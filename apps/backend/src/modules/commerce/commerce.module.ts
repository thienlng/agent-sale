import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { COMMERCE_FACADE } from './api/commerce.facade.js';
import { CATALOG_FACADE } from './api/catalog.facade.js';
import { CatalogService } from './application/catalog.service.js';
import { OrderService } from './application/order.service.js';
import { COMMERCE_STORE } from './application/ports/commerce-store.js';
import { DrizzleCommerceStore } from './infrastructure/persistence/commerce.drizzle-store.js';
import { UnavailableCommerceStore } from './infrastructure/persistence/unavailable-store.js';
import { CatalogController } from './interface/http/catalog.controller.js';
import { OrdersController } from './interface/http/orders.controller.js';
import { LodgingController } from './interface/http/lodging.controller.js';
import { LodgingService } from './application/lodging.service.js';
import { LODGING_STORE } from './application/ports/lodging-store.js';
import { DrizzleLodgingStore } from './infrastructure/persistence/lodging.drizzle-store.js';
import { CommerceUnavailableError } from './domain/commerce.errors.js';

/** Products, warehouses, inventory and orders (docs/02 ORD-*). Needs a database. */
@Module({
  imports: [IdentityModule, WorkspaceModule],
  controllers: [CatalogController, OrdersController, LodgingController],
  providers: [
    {
      provide: LODGING_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db
          ? new DrizzleLodgingStore(db)
          : { run: () => Promise.reject(new CommerceUnavailableError()) },
    },
    LodgingService,
    {
      provide: COMMERCE_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleCommerceStore(db) : new UnavailableCommerceStore(),
    },
    CatalogService,
    OrderService,
    { provide: COMMERCE_FACADE, useExisting: OrderService },
    { provide: CATALOG_FACADE, useExisting: CatalogService },
  ],
  exports: [COMMERCE_FACADE, CATALOG_FACADE],
})
export class CommerceModule {}
