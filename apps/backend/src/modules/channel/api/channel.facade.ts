import type {
  ChannelConnectionDto,
  CreateWebsiteRequest,
  UpdateWebsiteRequest,
  WebsiteSettings,
} from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface PendingMetaEvent {
  claimToken: string;
  id: string;
  workspaceId: WorkspaceId;
  connectionId: string;
  event: NormalizedEvent;
  /** 1-based claim count; the store stops claiming after MAX_EVENT_ATTEMPTS. */
  attempt: number;
}
export const MAX_EVENT_ATTEMPTS = 3;
type OutboundAttachment = { type: 'image' | 'video' | 'audio' | 'file'; url: string };
/** Either text or attachments (one, or several delivered as one album), as Meta accepts per message. */
export interface OutboundInboxMessage {
  text: string;
  attachments?: readonly OutboundAttachment[] | undefined;
}
/** What Meta knows about a customer; either part can be missing. */
export interface CustomerProfile {
  name: string | null;
  avatarUrl: string | null;
}
/** A website connection as the public widget API sees it; the signing secret stays in the module. */
export interface WebsiteSite {
  workspaceId: WorkspaceId;
  connectionId: string;
  siteKey: string;
  name: string;
  status: ChannelConnectionDto['status'];
  botId: string | null;
  settings: WebsiteSettings;
}
export interface ChannelFacade {
  createWebsite(ws: WorkspaceId, input: CreateWebsiteRequest): Promise<ChannelConnectionDto>;
  updateWebsite(
    ws: WorkspaceId,
    id: string,
    input: UpdateWebsiteRequest,
  ): Promise<ChannelConnectionDto>;
  /** Public lookup by site key (system role). Null when unknown. */
  resolveWebsite(siteKey: string): Promise<WebsiteSite | null>;
  /** Whether a browser `Origin` belongs to one of the site's domains (exact host or subdomain). */
  isOriginAllowed(site: WebsiteSite, origin: string | undefined): boolean;
  signVisitorToken(site: WebsiteSite, visitorId: string): Promise<string>;
  verifyVisitorToken(site: WebsiteSite, token: string): Promise<string | null>;
  /** Writes a website customer event into channel_webhook_events; false when it already exists. */
  enqueueWebsiteEvent(site: WebsiteSite, event: NormalizedEvent): Promise<boolean>;
  /** True while the visitor has an unprocessed message event (drives the widget's typing dots). */
  hasPendingCustomerEvent(connectionId: string, senderExternalId: string): Promise<boolean>;
  getConnection(ws: WorkspaceId, id: string): Promise<ChannelConnectionDto>;
  deliver(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    message: OutboundInboxMessage,
    key: string,
  ): Promise<{
    externalId: string | null;
    status: 'sent' | 'failed' | 'unknown';
    failureCode: string | null;
  }>;
  /** Best-effort "seen" / "typing…" bubble for the customer; never throws. */
  presence(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    action: 'mark_seen' | 'typing_on',
  ): Promise<void>;
  /**
   * Best-effort name and picture of a customer of this page (Messenger PSID or Instagram-scoped
   * id), read with the page token. Resolves `null` on any failure; the token never leaves the module.
   */
  fetchCustomerProfile(
    ws: WorkspaceId,
    channelId: string,
    customerExternalId: string,
  ): Promise<CustomerProfile | null>;
  /** Detaches a bot from every page that uses it, so conversations there fall back to staff. */
  unbindBot(ws: WorkspaceId, botId: string): Promise<number>;
  claimEvents(limit: number): Promise<PendingMetaEvent[]>;
  renewEvent(id: string, claimToken: string): Promise<boolean>;
  completeEvent(id: string, claimToken: string): Promise<void>;
  /** Terminal failure: keeps the payload for replay and stops further claims. */
  deadLetterEvent(id: string, claimToken: string): Promise<void>;
  /** Dead-letters events whose last attempt ended without completion (e.g. a crashed worker). */
  deadLetterExhaustedEvents(): Promise<string[]>;
  /** Ends a failed attempt early so the next claim can retry after `retryInMs` instead of the full lease. */
  releaseEvent(id: string, claimToken: string, retryInMs: number): Promise<void>;
  /** Hands the event back without spending an attempt, to be answered together with newer messages. */
  requeueEvent(id: string, claimToken: string): Promise<void>;
  /** Whether the same customer wrote again after this event (its answer would already be stale). */
  hasNewerCustomerEvent(
    connectionId: string,
    senderExternalId: string,
    afterEventId: string,
  ): Promise<boolean>;
}
export const CHANNEL_FACADE = Symbol('CHANNEL_FACADE');
