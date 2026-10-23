import { DomainError } from '@agent-sales/shared';

export class InvalidWorkspaceError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

export class WorkspaceNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Workspace not found', { id });
  }
}
