import { DomainError } from '@agent-sales/shared';

export class WebchatNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Webchat visitor not found', { id });
  }
}

export class WebchatStorageUnavailableError extends Error {
  constructor() {
    super('Image storage is not configured');
  }
}
