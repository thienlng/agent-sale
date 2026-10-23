import { WorkspaceCreatedV1 } from '@agent-sales/contracts';
import { newId, userId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { InMemoryWorkspaceRepository } from '../../../infrastructure/persistence/workspace.in-memory-repository.js';
import { InMemoryEventPublisher } from '../../../infrastructure/messaging/in-memory-event-publisher.js';
import { CreateWorkspaceHandler } from './create-workspace.handler.js';

describe('CreateWorkspaceHandler', () => {
  it('persists the workspace and publishes a versioned integration event', async () => {
    const repo = new InMemoryWorkspaceRepository();
    const events = new InMemoryEventPublisher();
    const handler = new CreateWorkspaceHandler(repo, events);

    const dto = await handler.execute({
      name: 'Shop ABC',
      industry: 'retail',
      ownerUserId: userId(newId()),
    });

    expect(await repo.findById(dto.id as never)).not.toBeNull();
    expect(events.published).toHaveLength(1);
    expect(WorkspaceCreatedV1.safeParse(events.published[0]?.event).success).toBe(true);
  });
});
