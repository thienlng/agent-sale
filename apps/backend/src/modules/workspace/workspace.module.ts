import { Module } from '@nestjs/common';

import { WORKSPACE_FACADE } from './api/workspace.facade.js';
import { CreateWorkspaceHandler } from './application/commands/create-workspace/create-workspace.handler.js';
import { EVENT_PUBLISHER } from './application/ports/event-publisher.js';
import { GetWorkspaceHandler } from './application/queries/get-workspace/get-workspace.handler.js';
import { WorkspaceFacadeImpl } from './application/workspace.facade.impl.js';
import { WORKSPACE_REPOSITORY } from './domain/ports/workspace.repository.js';
import { InMemoryEventPublisher } from './infrastructure/messaging/in-memory-event-publisher.js';
import { InMemoryWorkspaceRepository } from './infrastructure/persistence/workspace.in-memory-repository.js';
import { WorkspaceController } from './interface/http/workspace.controller.js';

/**
 * Providers are bound by token. The in-memory adapters are the default until
 * T-004 wires DrizzleWorkspaceRepository + the outbox publisher.
 * Exports ONLY what api/ declares.
 */
@Module({
  controllers: [WorkspaceController],
  providers: [
    CreateWorkspaceHandler,
    GetWorkspaceHandler,
    { provide: WORKSPACE_REPOSITORY, useClass: InMemoryWorkspaceRepository },
    { provide: EVENT_PUBLISHER, useClass: InMemoryEventPublisher },
    { provide: WORKSPACE_FACADE, useClass: WorkspaceFacadeImpl },
  ],
  exports: [WORKSPACE_FACADE],
})
export class WorkspaceModule {}
