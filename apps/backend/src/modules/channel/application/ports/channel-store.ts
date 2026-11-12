import type { ChannelConnectionDto, MetaProvider, WebsiteSettings } from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface GrantedAccount {
  externalId: string;
  name: string;
  token: string;
  expiresAt: string | null;
  /** App-scoped id of the Facebook user who granted the page (Facebook Login only). */
  grantorId?: string | null | undefined;
}
export interface ConnectionRecord extends ChannelConnectionDto {
  workspaceId: WorkspaceId;
  tokenSealed: string;
  /** `metaUserHash(grantorId)` of whoever connected the page (0076); null when unknown. */
  metaUserHash?: string | null | undefined;
}
/** A Meta data deletion request waiting for the worker (0076). */
export interface PendingDataDeletion {
  id: string;
  userHash: string;
}
/** What the public status page shows (0076). */
export interface DataDeletionRecord {
  confirmationCode: string;
  status: 'pending' | 'completed';
  requestedAt: Date;
  completedAt: Date | null;
  connectionsRemoved: number;
}
export interface OAuthFlow {
  id: string;
  workspaceId: WorkspaceId;
  userId: string;
  provider: MetaProvider;
  stateHash: string;
  browserHash: string;
  accountsSealed: string | null;
  expiresAt: Date;
}
export interface PendingMetaEvent {
  claimToken: string;
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  event: NormalizedEvent;
  attempt: number;
}
export interface ChannelStore {
  /** Connections shown to the workspace: everything except removed ones. */
  /** Removed pages are left out unless asked for. */
  list(ws: WorkspaceId, opts?: { includeRemoved?: boolean }): Promise<ConnectionRecord[]>;
  get(ws: WorkspaceId, id: string): Promise<ConnectionRecord | null>;
  update(
    ws: WorkspaceId,
    id: string,
    patch: {
      botId?: string | null;
      status?: ChannelConnectionDto['status'];
      name?: string;
      settings?: WebsiteSettings;
    },
  ): Promise<ConnectionRecord | null>;
  /**
   * Soft delete (T-133): status `removed`, bot unbound, sealed token replaced by `tokenSealed`.
   * The row, its conversations and statistics stay; `list` no longer returns it.
   */
  remove(
    ws: WorkspaceId,
    id: string,
    tokenSealed: string,
    audit?: { action: string; data: Record<string, unknown> },
  ): Promise<ConnectionRecord | null>;
  /** Live (not removed) connections of every workspace connected by this Facebook user. */
  connectionsOfMetaUser(userHash: string): Promise<ConnectionRecord[]>;
  /**
   * Pending deletion requests, oldest first, locked for this worker (`SKIP LOCKED`); each claim
   * counts an attempt, and a request is no longer claimed after 10.
   */
  claimDataDeletions(limit: number): Promise<PendingDataDeletion[]>;
  /** Marks the request completed and drops its user hash. */
  completeDataDeletion(id: string, connectionsRemoved: number): Promise<void>;
  dataDeletion(confirmationCode: string): Promise<DataDeletionRecord | null>;
  /** Inserts a new connection (website connections are created here, Meta ones through `select`). */
  create(record: ConnectionRecord): Promise<ConnectionRecord>;
  /** Cross-tenant lookup of a website connection by its public site key. */
  findWebsite(siteKey: string): Promise<ConnectionRecord | null>;
  /** Stores a customer event once per (connection, externalEventId); false when it already exists. */
  enqueueEvent(record: ConnectionRecord, event: NormalizedEvent): Promise<boolean>;
  /** True while the sender has an unprocessed message event on this connection. */
  hasPendingCustomerEvent(connectionId: string, senderExternalId: string): Promise<boolean>;
  /** Clears the bot binding of every connection pointing at `botId`; returns how many changed. */
  unbindBot(ws: WorkspaceId, botId: string): Promise<number>;
  /** Deletes the processed events of one sender on one connection; returns how many. */
  forgetCustomerEvents(
    ws: WorkspaceId,
    connectionId: string,
    senderExternalId: string,
  ): Promise<number>;
  createFlow(flow: OAuthFlow): Promise<void>;
  consumeState(
    provider: MetaProvider,
    stateHash: string,
    browserHash: string,
  ): Promise<OAuthFlow | null>;
  discovery(ws: WorkspaceId, userId: string, id: string): Promise<OAuthFlow | null>;
  select(
    ws: WorkspaceId,
    userId: string,
    id: string,
    accounts: ConnectionRecord[],
  ): Promise<ConnectionRecord[]>;
  claimEvents(limit: number): Promise<PendingMetaEvent[]>;
  renewEvent(id: string, claimToken: string): Promise<boolean>;
  completeEvent(id: string, claimToken: string): Promise<void>;
  /** Terminal failure: keeps the payload for replay and stops further claims. */
  deadLetterEvent(id: string, claimToken: string): Promise<void>;
  /** Dead-letters events whose last attempt ended without completion (e.g. a crashed worker). */
  deadLetterExhaustedEvents(): Promise<string[]>;
  /** Ends a failed attempt early so the next claim can retry after `retryInMs` instead of the full lease. */
  releaseEvent(id: string, claimToken: string, retryInMs: number): Promise<void>;
  /** Gives the event back untouched (no attempt consumed) so the next claim can merge it with newer ones. */
  requeueEvent(id: string, claimToken: string): Promise<void>;
  /** True when the same customer sent another unprocessed message after the event `afterEventId`. */
  hasNewerCustomerEvent(
    connectionId: string,
    senderExternalId: string,
    afterEventId: string,
  ): Promise<boolean>;
}
export const CHANNEL_STORE = Symbol('CHANNEL_STORE');
