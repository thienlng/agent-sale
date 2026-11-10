import { z } from 'zod';

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

/**
 * The page a website visitor wrote from. Sent by the visitor's browser, so it is untrusted: the
 * bot reads it to understand what the visitor refers to, never as a source of prices or terms.
 */
export const WebsitePageContext = z.object({
  url: z.string().max(1000),
  title: z.string().max(150),
  /** Most visible first; empty when the site marks no sections. */
  sections: z.array(WebsitePageSection).max(3).default([]),
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
  })
  .refine((b) => Boolean(b.text) !== Boolean(b.attachmentUrl), 'text or attachmentUrl, not both');
export type WidgetSendRequest = z.infer<typeof WidgetSendRequest>;

export const WidgetSendResponse = z.object({ visitorToken: z.string(), message: WidgetMessageDto });
export type WidgetSendResponse = z.infer<typeof WidgetSendResponse>;

export const WidgetPollResponse = z.object({
  messages: z.array(WidgetMessageDto),
  botTyping: z.boolean(),
  phoneCaptured: z.boolean(),
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
