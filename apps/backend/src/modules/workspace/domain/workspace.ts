import {
  AggregateRoot,
  newId,
  type UserId,
  type WorkspaceId,
  workspaceId,
} from '@agent-sales/shared';

import { InvalidWorkspaceError } from './workspace.errors.js';

export interface WorkspaceProps {
  id: WorkspaceId;
  name: string;
  industry: string;
  timezone: string;
  ownerUserId: UserId;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: Date;
}

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
    timezone?: string | undefined;
  }): Workspace {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 120)
      throw new InvalidWorkspaceError('name must be 1–120 characters');
    const industry = input.industry.trim();
    if (!industry) throw new InvalidWorkspaceError('industry is required');
    const id = workspaceId(newId());
    const ws = new Workspace({
      id,
      name,
      industry,
      timezone: input.timezone ?? 'Asia/Ho_Chi_Minh',
      ownerUserId: input.ownerUserId,
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

  get id(): WorkspaceId {
    return this.props.id;
  }

  snapshot(): Readonly<WorkspaceProps> {
    return { ...this.props };
  }
}
