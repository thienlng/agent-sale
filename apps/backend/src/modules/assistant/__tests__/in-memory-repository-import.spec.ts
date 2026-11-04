import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe } from 'vitest';

import type { OwnerScope } from '../domain/owner-scope.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';
import {
  importRepositoryCases,
  type ImportRepositoryHarness,
} from './factories/import-repository.cases.js';

function harness(): ImportRepositoryHarness {
  const repo = new InMemoryAssistantRepository();
  return {
    repo,
    repo2: repo,
    async owner(sameAccountAs?: OwnerScope) {
      const business = sameAccountAs?.businessId ?? workspaceId(newId());
      const s: OwnerScope = {
        accountId: sameAccountAs?.accountId ?? newId(),
        ownerUserId: userId(newId()),
        businessId: business,
        businessIds: [business],
      };
      const t = await repo.createThread(s, {
        id: newId(),
        title: '',
        systemPrompt: 'p',
        promptVersion: 'assistant@2',
      });
      return { s, threadId: t.id };
    },
  };
}

describe('InMemoryAssistantRepository: product import (T-173)', () => {
  importRepositoryCases(harness);
});
