import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import { WORKSPACE_LIFECYCLE, type WorkspaceLifecycle } from '../../../workspace/api/index.js';
import { ConnectionService } from '../connection.service.js';
import { INTEGRATION_STORE, type IntegrationStore } from '../ports/integration-store.js';

/** A deleted business (ADR-033) stops syncing at once: its live KiotViet store is disconnected. */
@Injectable()
export class OnWorkspaceDeletionRequested implements OnModuleInit {
  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(ConnectionService) private readonly connections: ConnectionService,
    @Inject(WORKSPACE_LIFECYCLE) @Optional() private readonly lifecycle?: WorkspaceLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onDeletionRequested('integration', (ws) => this.handle(ws));
  }

  async handle(ws: WorkspaceId): Promise<void> {
    if (await this.store.liveConnection(ws, 'kiotviet')) await this.connections.disconnect(ws);
  }
}
