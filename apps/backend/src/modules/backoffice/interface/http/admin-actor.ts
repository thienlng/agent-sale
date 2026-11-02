import type { AdminActor } from '../../../billing/api/index.js';
import type { AuthState } from '../../../../common/http/auth-context.js';

/** The signed-in platform admin, for the audit trail. */
export async function adminActor(user: AuthState): Promise<AdminActor> {
  return { userId: user.userId, name: (await user.displayName?.()) ?? null };
}
