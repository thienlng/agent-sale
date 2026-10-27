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

export const WidgetSendRequest = z
  .object({
    clientMessageId: z.uuid(),
    text: z.string().trim().max(2000).optional(),
    attachmentUrl: z.url({ protocol: /^https$/ }).optional(),
    page: z.object({ url: z.string().max(1000), title: z.string().max(150) }),
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
  contactId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type WebsiteVisitorDto = z.infer<typeof WebsiteVisitorDto>;
