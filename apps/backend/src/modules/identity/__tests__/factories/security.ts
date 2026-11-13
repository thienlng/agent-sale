import { LocalMailer } from '../../../../common/email/mailer.js';
import { SecurityEventService } from '../../application/security-events.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import { InMemorySecurityEventRepository } from '../../infrastructure/persistence/identity.in-memory-repositories.js';

/** Security events kept in memory, with the mailer that receives the notices. */
export function securityEvents(users: UserRepository, mailer = new LocalMailer('test')) {
  const repo = new InMemorySecurityEventRepository();
  return { repo, mailer, service: new SecurityEventService(repo, users, mailer) };
}
