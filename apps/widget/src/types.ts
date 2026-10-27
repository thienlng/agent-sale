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
}

export interface WidgetSendRequest {
  clientMessageId: string;
  text?: string;
  attachmentUrl?: string;
  page: { url: string; title: string };
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
