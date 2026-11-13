import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  EXTERNAL_IDENTITY_REPOSITORY,
  type ExternalIdentityRepository,
} from '../domain/ports/external-identity.repository.js';
import { ApiKeyService } from './api-key.service.js';
import { SecurityEventService } from './security-events.js';

/**
 * What a password reset ends besides the sessions (docs/09 §2). The reset proves control of the
 * mailbox only, so everything someone else may have attached to the account goes:
 *
 * - linked sign-ins (Google): a Google account made for the address before the owner signed up
 *   (pre-hijack) must not keep a way in;
 * - API keys the user created, in every workspace (they act for the user). Keys created by other
 *   members are untouched: they are not this user's credentials.
 *
 * Then the user gets a notice email.
 */
@Injectable()
export class CredentialResetService {
  constructor(
    @Inject(EXTERNAL_IDENTITY_REPOSITORY) private readonly identities: ExternalIdentityRepository,
    @Inject(ApiKeyService) private readonly apiKeys: ApiKeyService,
    @Inject(SecurityEventService) private readonly events: SecurityEventService,
  ) {}

  async afterPasswordReset(userId: UserId, ip: string | null): Promise<void> {
    const unlinked = await this.identities.unlinkAll(userId);
    const apiKeys = await this.apiKeys.revokeAllCreatedBy(userId);
    if (unlinked > 0)
      await this.events.record(userId, 'identity.unlinked', { count: unlinked }, ip);
    await this.events.record(userId, 'password.reset', { unlinked, apiKeys }, ip);
    await this.events.notify(userId, 'password_reset');
  }
}
