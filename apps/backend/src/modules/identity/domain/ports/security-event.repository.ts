import type { UserId } from '@agent-sales/shared';

/** Account-level security actions, `<area>.<verb>`. */
export type SecurityAction =
  | 'password.reset'
  | 'mfa.enabled'
  | 'mfa.disabled'
  | 'mfa.recovery_codes_replaced'
  | 'mfa.recovery_code_used'
  | 'identity.linked'
  | 'identity.unlinked'
  | 'session.revoked'
  | 'session.step_up'
  | 'api_key.created'
  | 'api_key.revoked';

export interface SecurityEvent {
  id: string;
  userId: UserId;
  action: SecurityAction;
  /** Context only: ids, method names, counts. Never secrets, codes or tokens. */
  data: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}

/** Append-only log of a user's security events (global table `user_security_events`, 0076). */
export interface SecurityEventRepository {
  append(event: SecurityEvent): Promise<void>;
  /** The user's events, newest first. */
  listForUser(userId: UserId, limit: number): Promise<SecurityEvent[]>;
}

export const SECURITY_EVENT_REPOSITORY = Symbol('SECURITY_EVENT_REPOSITORY');
