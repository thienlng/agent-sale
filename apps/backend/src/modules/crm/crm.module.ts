import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_TENANT } from '../../common/db/db.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { CONTACT_SYNC_FACADE } from './api/contact-sync.facade.js';
import { CRM_EXPORT } from './api/crm-export.js';
import { CRM_FACADE } from './api/crm.facade.js';
import { ConversationTagsService } from './application/conversation-tags.service.js';
import { ContactService } from './application/contact.service.js';
import { ContactSyncService } from './application/contact-sync.service.js';
import { CrmFacadeImpl } from './application/crm.facade.impl.js';
import { CustomerRequestService } from './application/customer-request.service.js';
import { OwnershipService } from './application/ownership.service.js';
import { CrmSettingsService } from './application/crm-settings.service.js';
import { DistributionService } from './application/distribution.service.js';
import { CRM_STORE } from './application/ports/crm-store.js';
import { SavedViewService } from './application/saved-view.service.js';
import { TagAssignmentService } from './application/tag-assignment.service.js';
import { CrmExportSource } from './infrastructure/export/crm.export.js';
import { DrizzleCrmStore } from './infrastructure/persistence/crm.drizzle-store.js';
import { UnavailableCrmStore } from './infrastructure/persistence/unavailable-store.js';
import { ContactsController } from './interface/http/contacts.controller.js';
import { CrmSettingsController } from './interface/http/crm-settings.controller.js';
import { CustomerRequestsController } from './interface/http/customer-requests.controller.js';

/** Customers, sources, statuses, tags and saved views (docs/02 CRM-*). Needs a database. */
@Module({
  imports: [IdentityModule, WorkspaceModule],
  controllers: [ContactsController, CrmSettingsController, CustomerRequestsController],
  providers: [
    {
      provide: CRM_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleCrmStore(db) : new UnavailableCrmStore(),
    },
    {
      provide: CRM_EXPORT,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) => new CrmExportSource(db ?? null),
    },
    ContactService,
    CustomerRequestService,
    CrmSettingsService,
    DistributionService,
    TagAssignmentService,
    ConversationTagsService,
    SavedViewService,
    OwnershipService,
    { provide: CRM_FACADE, useClass: CrmFacadeImpl },
    ContactSyncService,
    { provide: CONTACT_SYNC_FACADE, useExisting: ContactSyncService },
  ],
  exports: [CRM_FACADE, CONTACT_SYNC_FACADE, CRM_EXPORT],
})
export class CrmModule {}
