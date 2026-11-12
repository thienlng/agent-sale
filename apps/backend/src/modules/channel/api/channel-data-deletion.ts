import type { MetaDataDeletionStatus } from '@agent-sales/contracts';

/**
 * Meta data deletion requests (docs/07 "Data deletion callback"). `tick` is run by the worker
 * entry every minute; `status` answers the public status route.
 */
export interface ChannelDataDeletionRunner {
  /** Processes up to 10 pending requests; returns how many were claimed. */
  tick(): Promise<number>;
  /** Throws NOT_FOUND for an unknown or malformed code. */
  status(confirmationCode: string): Promise<MetaDataDeletionStatus>;
}
export const CHANNEL_DATA_DELETION_RUNNER = Symbol('CHANNEL_DATA_DELETION_RUNNER');
