import { DomainError } from '@agent-sales/shared';

export class ContactNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Customer not found', { id });
  }
}

export class NoteNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Note not found', { id });
  }
}

export class CrmOptionNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(kind: 'source' | 'status', id: string) {
    super(kind === 'source' ? 'Customer source not found' : 'Customer status not found', {
      kind,
      id,
    });
  }
}

export class TagNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Tag not found', { id });
  }
}

export class TagAssignmentNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Tag assignment not found', { id });
  }
}

/** Private views of other members answer NOT_FOUND: their existence is not disclosed. */
export class SavedViewNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('View not found', { id });
  }
}

/** Someone saved a newer version since this one was loaded. */
export class StaleVersionError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(entity: string, current: number) {
    super('This was changed by someone else; reload and try again', { entity, version: current });
  }
}

export class InvalidContactError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(fields: Record<string, string>) {
    super('Some customer fields are invalid', { fields });
  }
}

/** Archived sources/statuses/tags stay readable but cannot be newly chosen. */
export class ArchivedChoiceError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(kind: 'source' | 'status' | 'tag', id: string) {
    super(`This ${kind} is archived and cannot be chosen`, { kind, id });
  }
}

export class NotAMemberError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(role: 'sales' | 'care', userId: string) {
    super('Only active members of this workspace can be assigned', { role, userId });
  }
}

export class TagValuesInvalidError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(fields: Record<string, string>) {
    super('Some tag values are missing or invalid', { fields });
  }
}

export class DuplicateTagNameError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(name: string) {
    super('A tag with this name already exists', { name });
  }
}

export class TagFieldChangeError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(key: string) {
    super('A tag field cannot be removed or change type once defined; archive it instead', {
      key,
    });
  }
}

export class CrmUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Customers need a database (DATABASE_URL is not configured)');
  }
}

export class ViewNotOwnedError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor(id: string) {
    super('Only the owner can change this view', { id });
  }
}

/** The same create form was submitted twice at once; the caller returns the first contact. */
export class DuplicateContactRequestError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This customer was already submitted');
  }
}
