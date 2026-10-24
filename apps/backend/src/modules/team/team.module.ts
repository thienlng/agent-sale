import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';

import { DB_SYSTEM, DB_TENANT } from '../../common/db/db.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { TEAM_FACADE } from './api/team.facade.js';
import { INVITATION_STORE } from './application/ports/invitation-store.js';
import { TeamService } from './application/team.service.js';
import { DrizzleInvitationStore } from './infrastructure/persistence/invitation.drizzle-store.js';
import { UnavailableInvitationStore } from './infrastructure/persistence/unavailable-store.js';
import { TeamController } from './interface/http/team.controller.js';

/** Members and invitation links (docs/02 SET-01). Member rows belong to `workspace`. */
@Module({
  imports: [IdentityModule, WorkspaceModule],
  controllers: [TeamController],
  providers: [
    {
      provide: INVITATION_STORE,
      inject: [
        { token: DB_TENANT, optional: true },
        { token: DB_SYSTEM, optional: true },
      ],
      useFactory: (tenant: Database | null | undefined, system: Database | null | undefined) =>
        tenant && system
          ? new DrizzleInvitationStore(tenant, system)
          : new UnavailableInvitationStore(),
    },
    TeamService,
    { provide: TEAM_FACADE, useExisting: TeamService },
  ],
  exports: [TEAM_FACADE],
})
export class TeamModule {}
