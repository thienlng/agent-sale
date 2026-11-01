/**
 * Contract every channel adapter implements (docs/07 §2). The product code
 * never calls a platform SDK directly — only through an adapter.
 */

export type ChannelKind =
  'facebook' | 'instagram' | 'zalo_oa' | 'tiktok' | 'lazada' | 'website' | 'email';

export interface NormalizedEvent {
  kind: ChannelKind;
  /** Platform id of the asset (page id, OA id, site key). */
  assetExternalId: string;
  externalEventId: string;
  externalMessageId?: string;
  type:
    | 'message'
    | 'echo'
    | 'read'
    | 'delivery'
    | 'postback'
    | 'comment'
    | 'referral'
    | 'reaction'
    | 'other';
  senderExternalId: string;
  occurredAt: Date;
  text?: string;
  /** Payload of the quick reply the customer tapped; `text` stays the button title. */
  quickReplyPayload?: string;
  attachments?: Array<{ type: 'image' | 'video' | 'file' | 'audio' | 'sticker'; url: string }>;
  /** Raw payload kept for investigation (retention 30 days). */
  raw: unknown;
  comment?: {
    postId: string;
    commentId: string;
    parentId: string | null;
    operation: 'add' | 'edited' | 'remove';
  };
}

export interface OutboundMessage {
  text?: string;
  attachments?: Array<{ type: 'image' | 'video' | 'audio' | 'file'; url: string }>;
  /** Rich content rendered per channel capability (product card, album…). */
  rich?: { kind: 'product_card' | 'album' | 'quick_replies'; data: unknown };
  /** Buttons under the text (at most 3, titles of 20 characters or fewer); see `capabilities`. */
  quickReplies?: { title: string; payload: string }[];
}

export interface SendResult {
  externalMessageId: string;
}

export type ConnectorErrorCode =
  'auth_expired' | 'rate_limited' | 'window_closed' | 'invalid_template' | 'unknown';

export interface ConnectorError {
  code: ConnectorErrorCode;
  retryable: boolean;
  userAction?: 'reauth' | 'fix_template' | 'slow_down' | 'contact_support';
  detail?: string;
}

export interface ChannelCapabilities {
  richCards: boolean;
  quickReplies: boolean;
  media: boolean;
  /** Free-form reply window after the last inbound message, in hours; null = unlimited. */
  replyWindowHours: number | null;
}

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret: string,
  ): boolean;
  parseWebhook(body: unknown): NormalizedEvent[];
  send(
    asset: { externalId: string; token: string },
    to: string,
    message: OutboundMessage,
    opts: { idempotencyKey: string },
  ): Promise<SendResult>;
  capabilities(): ChannelCapabilities;
  mapError(error: unknown): ConnectorError;
}
