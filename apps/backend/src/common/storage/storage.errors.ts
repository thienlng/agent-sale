import { DomainError } from '@agent-sales/shared';

/** The upload is not a canonical-base64 PNG/JPEG/WebP within the size limit. */
export class InvalidImageError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(maxBytes = 1_048_576) {
    super(`Upload a PNG, JPEG or WebP image no larger than ${maxBytes / 1_048_576} MiB`, {
      reason: 'INVALID_IMAGE',
    });
  }
}

export class MediaStorageUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Image storage is not configured or is unavailable', {
      reason: 'MEDIA_STORAGE_UNAVAILABLE',
    });
  }
}
