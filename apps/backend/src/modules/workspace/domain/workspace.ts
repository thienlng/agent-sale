import {
  AggregateRoot,
  newId,
  type UserId,
  type WorkspaceId,
  workspaceId,
} from '@agent-sales/shared';

import {
  BusinessNameMismatchError,
  BusinessNotActiveError,
  BusinessNotDeletedError,
  InvalidWorkspaceError,
  RestoreWindowClosedError,
} from './workspace.errors.js';

export interface WorkspaceProps {
  id: WorkspaceId;
  name: string;
  industry: string;
  timezone: string;
  ownerUserId: UserId;
  /** Owning account (ADR-012). Null only for rows the account backfill has not reached. */
  accountId: string | null;
  status: WorkspaceStatus;
  createdAt: Date;
  /** When the owner asked to delete it (ADR-032); null while active. */
  deletedAt?: Date | null;
  /** End of the restore window; the purge runs after it. */
  purgeAfter?: Date | null;
}

/**
 * `active` → `pending_deletion` (owner deleted it; restorable until `purgeAfter`) → `deleted`
 * (purged tombstone, written by the purge). `suspended` is reserved; nothing writes it today.
 */
export type WorkspaceStatus = 'active' | 'suspended' | 'pending_deletion' | 'deleted';

/** How long a deleted business can be restored (docs/09 §10). */
export const RESTORE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Aggregate root. Always valid: construct through `Workspace.create` or
 * `Workspace.rehydrate`; mutate through methods that enforce invariants.
 */
export class Workspace extends AggregateRoot {
  private constructor(private props: WorkspaceProps) {
    super();
  }

  static create(input: {
    name: string;
    industry: string;
    ownerUserId: UserId;
    accountId: string;
    timezone?: string | undefined;
    /** Chosen up front when other records must name the business before it exists. */
    id?: WorkspaceId | undefined;
  }): Workspace {
    const { name, industry } = Workspace.validate(input);
    const id = input.id ?? workspaceId(newId());
    const ws = new Workspace({
      id,
      name,
      industry,
      timezone: input.timezone ?? 'Asia/Ho_Chi_Minh',
      ownerUserId: input.ownerUserId,
      accountId: input.accountId,
      status: 'active',
      createdAt: new Date(),
    });
    ws.raise({
      name: 'workspace.created',
      workspaceId: id,
      occurredAt: ws.props.createdAt,
      payload: { ownerUserId: input.ownerUserId, industry },
    });
    return ws;
  }

  /** Name and industry rules, checked before anything (such as an account) is created. */
  static validate(input: { name: string; industry: string }): { name: string; industry: string } {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 120)
      throw new InvalidWorkspaceError('name must be 1–120 characters');
    const industry = input.industry.trim();
    if (!industry) throw new InvalidWorkspaceError('industry is required');
    return { name, industry };
  }

  /** Rebuild from persistence without re-running creation side effects. */
  static rehydrate(props: WorkspaceProps): Workspace {
    return new Workspace(props);
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 120)
      throw new InvalidWorkspaceError('name must be 1–120 characters');
    this.props = { ...this.props, name: trimmed };
  }

  /**
   * The owner deletes the business (ADR-032). `confirmName` must equal the name (both trimmed,
   * case-sensitive): the typed name is the guard against deleting the wrong business.
   */
  requestDeletion(input: { confirmName: string; actorUserId: UserId; now: Date }): void {
    if (this.props.status !== 'active') throw new BusinessNotActiveError(this.props.status);
    if (input.confirmName.trim() !== this.props.name.trim()) throw new BusinessNameMismatchError();
    const purgeAfter = new Date(input.now.getTime() + RESTORE_WINDOW_DAYS * DAY_MS);
    this.props = { ...this.props, status: 'pending_deletion', deletedAt: input.now, purgeAfter };
    this.raise({
      name: 'workspace.deletion_requested',
      workspaceId: this.props.id,
      occurredAt: input.now,
      payload: { actorUserId: input.actorUserId, purgeAfter: purgeAfter.toISOString() },
    });
  }

  /** Back to active before the purge; channels stay disconnected (the owner reconnects them). */
  restore(input: { actorUserId: UserId; now: Date }): void {
    if (this.props.status !== 'pending_deletion') throw new BusinessNotDeletedError();
    if (!this.props.purgeAfter || this.props.purgeAfter.getTime() <= input.now.getTime())
      throw new RestoreWindowClosedError();
    this.props = { ...this.props, status: 'active', deletedAt: null, purgeAfter: null };
    this.raise({
      name: 'workspace.restored',
      workspaceId: this.props.id,
      occurredAt: input.now,
      payload: { actorUserId: input.actorUserId },
    });
  }

  get id(): WorkspaceId {
    return this.props.id;
  }

  snapshot(): Readonly<WorkspaceProps> {
    return { ...this.props };
  }
}
