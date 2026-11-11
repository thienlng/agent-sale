import { DomainError } from '@agent-sales/shared';

import type { CareEventSource, CareStore } from '../../domain/ports/care.store.js';

class CareUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('The care agent requires a configured database');
  }
}

const unavailable = (): Promise<never> => Promise.reject(new CareUnavailableError());

/** Without a database every care route answers 503 and the worker has nothing to do. */
export class UnavailableCareStore implements CareStore {
  templates = unavailable;
  putTemplate = unavailable;
  reserveUsage = unavailable;
  releaseUsage = unavailable;
  usedOn = unavailable;
  enroll = unavailable;
  stopConversation = unavailable;
  claimDue = () => Promise.resolve([]);
  advance = unavailable;
  finish = unavailable;
  stop = unavailable;
  reschedule = unavailable;
  afterSaleDue = () => Promise.resolve([]);
  insertMessage = unavailable;
  getMessage = unavailable;
  messagesOf = unavailable;
  drafts = () => Promise.resolve([]);
  claimDraft = unavailable;
  finishSend = unavailable;
  rejectDraft = unavailable;
  sentTimes = unavailable;
  sentBetween = unavailable;
  expireDue = () => Promise.resolve(0);
}

export class UnavailableCareEventSource implements CareEventSource {
  withLease<T>(): Promise<T | null> {
    return Promise.resolve(null);
  }
}
