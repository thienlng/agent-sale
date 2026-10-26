import type { InvitationStore } from '../../application/ports/invitation-store.js';
import { TeamUnavailableError } from '../../domain/team.errors.js';

const fail = () => Promise.reject(new TeamUnavailableError());

/** Without a database, invitations answer 503. */
export class UnavailableInvitationStore implements InvitationStore {
  list = fail;
  find = fail;
  countPending = fail;
  replacePending = fail;
  revoke = fail;
  findByTokenHash = fail;
  markAccepted = fail;
  releaseAccepted = fail;
}
