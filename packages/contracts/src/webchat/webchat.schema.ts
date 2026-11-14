import { z } from 'zod';
import { MessageUi } from '../conversation/message-ui.schema.js';

/** Public look of a site as the widget needs it; never carries `domains` or the bot id. */
export const WidgetConfigDto = z.object({
  color: z.string(),
  position: z.enum(['left', 'right']),
  agentName: z.string(),
  avatarUrl: z.string().nullable(),
  greeting: z.string(),
  phonePrompt: z.string(),
  phoneChipText: z.string(),
  language: z.enum(['vi', 'en']),
  /**
   * Cloudflare Turnstile site key when the platform requires a challenge for new visitors (off by
   * default). The widget loads the challenge only then and sends its token with the first message
   * or upload of a new visitor. Absent from older backends.
   */
  turnstileSiteKey: z.string().optional(),
});
export type WidgetConfigDto = z.infer<typeof WidgetConfigDto>;

export const WidgetMessageDto = z.object({
  id: z.uuid(),
  role: z.enum(['customer', 'agent']),
  text: z.string(),
  imageUrl: z.string().nullable(),
  /** The widget's own id of a customer message (de-duplication on the client); null for agent messages. */
  clientMessageId: z.uuid().nullable(),
  at: z.iso.datetime(),
  /** Product cards and suggested next steps of a bot message (ADR-029). */
  ui: MessageUi.optional(),
});
export type WidgetMessageDto = z.infer<typeof WidgetMessageDto>;

/**
 * A part of the page the visitor had on screen when writing: an element the site marked with
 * `data-rapiz-section` (its name) and what it shows (`data-rapiz-context`, else its own text).
 */
export const WebsitePageSection = z.object({
  name: z.string().trim().min(1).max(80),
  text: z.string().trim().max(400),
});
export type WebsitePageSection = z.infer<typeof WebsitePageSection>;

export const MAX_PAGE_LINKS = 24;

/** A place on the visitor's site: a section of the page or a page linked from it. */
export const WebsitePageLink = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().max(1000),
});
export type WebsitePageLink = z.infer<typeof WebsitePageLink>;

/**
 * The page a website visitor wrote from. Sent by the visitor's browser, so it is untrusted: the
 * bot reads it to understand what the visitor refers to, never as a source of prices or terms.
 */
export const WebsitePageContext = z.object({
  url: z.string().max(1000),
  title: z.string().max(150),
  /** Most visible first; empty when the site marks no sections. */
  sections: z.array(WebsitePageSection).max(3).default([]),
  /**
   * Where the visitor can go from this page: its own sections (`url` with a `#fragment`) and the
   * same-site links of its header, navigation and footer, as the widget found them. The bot may
   * only suggest these; the server keeps those on the page's own origin.
   */
  nav: z.array(WebsitePageLink).max(MAX_PAGE_LINKS).optional(),
});
export type WebsitePageContext = z.infer<typeof WebsitePageContext>;

export const WidgetSendRequest = z
  .object({
    clientMessageId: z.uuid(),
    text: z.string().trim().max(2000).optional(),
    attachmentUrl: z.url({ protocol: /^https$/ }).optional(),
    page: WebsitePageContext,
    firstUrl: z.string().max(1000).optional(),
    referrer: z.string().max(500).optional(),
    /** Greeting + invites the visitor saw before writing; stored with the first message. */
    seen: z.array(z.string().max(300)).max(5).optional(),
    /** Turnstile token; required on a new visitor's first message when the config named a site key. */
    turnstileToken: z.string().max(2048).optional(),
  })
  .refine((b) => Boolean(b.text) !== Boolean(b.attachmentUrl), 'text or attachmentUrl, not both');
export type WidgetSendRequest = z.infer<typeof WidgetSendRequest>;

export const WidgetSendResponse = z.object({ visitorToken: z.string(), message: WidgetMessageDto });
export type WidgetSendResponse = z.infer<typeof WidgetSendResponse>;

export const WidgetPollResponse = z.object({
  messages: z.array(WidgetMessageDto),
  botTyping: z.boolean(),
  phoneCaptured: z.boolean(),
  /** The visitor left a phone or an email (the lead form is done); absent from older backends. */
  contactCaptured: z.boolean().optional(),
  phoneRequired: z.boolean(),
});
export type WidgetPollResponse = z.infer<typeof WidgetPollResponse>;

/** `visitorToken` is present only when the upload started the visitor (no token was sent). */
export const WidgetUploadResponse = z.object({
  url: z.string(),
  visitorToken: z.string().optional(),
});
export type WidgetUploadResponse = z.infer<typeof WidgetUploadResponse>;

export const WidgetPhoneRequest = z.object({ phone: z.string().trim().min(6).max(30) });
export type WidgetPhoneRequest = z.infer<typeof WidgetPhoneRequest>;

export const WidgetPhoneResponse = z.object({ phoneCaptured: z.literal(true) });
export type WidgetPhoneResponse = z.infer<typeof WidgetPhoneResponse>;

/** The lead form: a phone number or an email in one field, and an optional name. */
export const WidgetContactRequest = z.object({
  contact: z.string().trim().min(3).max(254),
  name: z.string().trim().max(80).optional(),
});
export type WidgetContactRequest = z.infer<typeof WidgetContactRequest>;

export const WidgetContactResponse = z.object({ captured: z.enum(['phone', 'email']) });
export type WidgetContactResponse = z.infer<typeof WidgetContactResponse>;

/** What staff see about a website visitor in the conversation side panel. */
export const WebsiteVisitorDto = z.object({
  firstUrl: z.string().nullable(),
  referrer: z.string().nullable(),
  lastUrl: z.string().nullable(),
  lastTitle: z.string().nullable(),
  phone: z.string().nullable(),
  /** Email the visitor left in a message; absent from older backends. */
  email: z.string().nullable().default(null),
  contactId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type WebsiteVisitorDto = z.infer<typeof WebsiteVisitorDto>;
