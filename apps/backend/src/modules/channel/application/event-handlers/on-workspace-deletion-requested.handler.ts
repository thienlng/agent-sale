import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import { WORKSPACE_LIFECYCLE, type WorkspaceLifecycle } from '../../../workspace/api/index.js';
import { ChannelFacadeImpl } from '../channel.facade.impl.js';

/**
 * The owner deleted the business (ADR-032): every Facebook/Instagram page is removed (sealed token
 * wiped, Meta webhook unsubscribed, best effort) and every website chat is turned off, so no event
 * comes in and nothing goes out. A restore leaves them so; the owner reconnects.
 */
@Injectable()
export class OnWorkspaceDeletionRequested implements OnModuleInit {
  constructor(
    @Inject(ChannelFacadeImpl) private readonly channels: ChannelFacadeImpl,
    @Inject(WORKSPACE_LIFECYCLE) @Optional() private readonly lifecycle?: WorkspaceLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onDeletionRequested('channel', (ws) => this.handle(ws));
  }

  async handle(ws: WorkspaceId): Promise<void> {
    for (const c of (await this.channels.list(ws)).data) {
      if (c.provider === 'website') {
        if (c.status === 'connected')
          await this.channels.updateWebsite(ws, c.id, { enabled: false });
      } else {
        await this.channels.remove(ws, c.id);
      }
    }
  }
}
