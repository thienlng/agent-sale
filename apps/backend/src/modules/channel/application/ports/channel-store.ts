import type { ChannelConnectionDto, MetaProvider, WebsiteSettings } from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface GrantedAccount {
  externalId: string;
  name: string;
  token: string;
  expiresAt: string | null;
}
export interface ConnectionRecord extends ChannelConnectionDto {
  workspaceId: WorkspaceId;
  tokenSealed: string;
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
  list(ws: WorkspaceId): Promise<ConnectionRecord[]>;
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
