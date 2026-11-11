import { DomainError } from '@agent-sales/shared';

import type { BrainStore, MessageEventSource } from '../../domain/ports/brain.store.js';

class BrainUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Business Brain requires a configured database');
  }
}

const unavailable = (): Promise<never> => Promise.reject(new BrainUnavailableError());

/** Without a database every Brain route answers 503 and the worker has nothing to do. */
export class UnavailableBrainStore implements BrainStore {
  getSettings = unavailable;
  putSettings = unavailable;
  getSignal = unavailable;
  signalsFor = unavailable;
  saveEvaluation = unavailable;
  saveStage = unavailable;
  dismissSignal = unavailable;
  undismissSignal = unavailable;
  scheduleJob = unavailable;
  claimDueJobs = unavailable;
  finishJob = unavailable;
  capJob = unavailable;
  retryJob = unavailable;
  resetCappedJobs = unavailable;
  reserveUsage = unavailable;
  releaseUsage = unavailable;
  usedOn = unavailable;
  recordRun = unavailable;
  todaySignalRefs = unavailable;
  pendingJobIds = unavailable;
  briefingStates = unavailable;
  claimBriefing = unavailable;
}

export class UnavailableMessageEventSource implements MessageEventSource {
  withLease(): Promise<null> {
    return Promise.resolve(null);
  }
}
