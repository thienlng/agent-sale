/**
 * Wire types of the public widget API. They mirror `packages/contracts/src/webchat`
 * (WidgetConfigDto, WidgetMessageDto, WidgetSendRequest/Response, WidgetPollResponse,
 * WidgetUploadResponse, WidgetPhoneRequest) and MUST stay in sync with it.
 * Declared locally so the bundle never pulls zod.
 */

export type WidgetLanguage = 'vi' | 'en';

export interface WidgetConfig {
  color: string;
  position: 'left' | 'right';
  agentName: string;
  avatarUrl: string | null;
  greeting: string;
  phonePrompt: string;
  phoneChipText: string;
  language: WidgetLanguage;
}

export interface WidgetMessage {
  id: string;
  role: 'customer' | 'agent';
  text: string;
  imageUrl: string | null;
  /** The widget's own id of a customer message (null for agent messages). */
  clientMessageId: string | null;
  at: string;
  /** Agent messages: product cards and suggested next steps (mirrors `MessageUi`, ADR-029). */
  ui?: MessageUi;
}

/** A product card: tapping it asks the bot about the product. */
export interface MessageCard {
  productId: string;
  title: string;
  price: string;
  imageUrl: string | null;
}

/** A follow-up button: a reply sent as the visitor, or a place on the site to go to. */
export type MessageSuggestion =
  { kind: 'reply'; text: string } | { kind: 'link'; title: string; url: string };

export interface MessageUi {
  cards?: MessageCard[];
  suggestions?: MessageSuggestion[];
}

/** A marked part of the page on screen (mirrors `WebsitePageSection` in contracts). */
export interface PageSection {
  name: string;
  text: string;
}

/** A section of this page or a same-site page the bot may suggest (mirrors `WebsitePageLink`). */
export interface PageLink {
  label: string;
  url: string;
}

export interface WidgetSendRequest {
  clientMessageId: string;
  text?: string;
  attachmentUrl?: string;
  page: { url: string; title: string; sections: PageSection[]; nav: PageLink[] };
  firstUrl?: string;
  referrer?: string;
  seen?: string[];
}

export interface WidgetSendResponse {
  visitorToken: string;
  message: WidgetMessage;
}

export interface WidgetPollResponse {
  messages: WidgetMessage[];
  botTyping: boolean;
  phoneCaptured: boolean;
  phoneRequired: boolean;
}

export interface WidgetUploadResponse {
  url: string;
  /** Present when the upload started the visitor (no token was sent). */
  visitorToken?: string;
}

export interface WidgetPhoneRequest {
  phone: string;
}
