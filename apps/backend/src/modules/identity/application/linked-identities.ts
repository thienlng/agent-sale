import type { LinkedIdentityDto } from '@agent-sales/contracts';
import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  LastSignInMethodError,
  LinkedIdentityNotFoundError,
  SessionInvalidError,
} from '../domain/identity.errors.js';
import {
  EXTERNAL_IDENTITY_REPOSITORY,
  type ExternalIdentityRepository,
  type IdentityProvider,
} from '../domain/ports/external-identity.repository.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import { SecurityEventService } from './security-events.js';

/**
 * The sign-ins linked to the user's account (Google today), as listed in account security. Removing
 * one is a step-up action (the route requires a recent re-authentication); the last way to sign in
 * of a user without a password cannot be removed.
 */
@Injectable()
export class LinkedIdentityService {
  constructor(
    @Inject(EXTERNAL_IDENTITY_REPOSITORY) private readonly identities: ExternalIdentityRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SecurityEventService) private readonly events: SecurityEventService,
  ) {}

  async list(userId: UserId): Promise<LinkedIdentityDto[]> {
    return (await this.identities.listForUser(userId)).map((i) => ({
      provider: i.provider,
      subject: i.subject,
      email: i.email,
      createdAt: i.createdAt.toISOString(),
      lastLoginAt: i.lastLoginAt.toISOString(),
    }));
  }

  async unlink(
    userId: UserId,
    provider: IdentityProvider,
    subject: string,
    ip: string | null,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    const links = await this.identities.listForUser(userId);
    if (!links.some((l) => l.provider === provider && l.subject === subject))
      throw new LinkedIdentityNotFoundError();
    if (!user.hasPassword && links.length === 1) throw new LastSignInMethodError();
    if (!(await this.identities.unlink(userId, provider, subject)))
      throw new LinkedIdentityNotFoundError();
    await this.events.record(userId, 'identity.unlinked', { provider }, ip);
  }
}
