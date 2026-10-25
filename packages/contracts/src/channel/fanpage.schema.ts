import { z } from 'zod';
export const FacebookId = z
  .string()
  .regex(/^[0-9]+(?:_[0-9]+)?$/)
  .max(200);
export const FanpageSettings = z.object({
  publicReplies: z.boolean().default(false),
  privateReplies: z.boolean().default(false),
  hideComments: z.boolean().default(false),
  hideKeywords: z.array(z.string().trim().min(2).max(80)).max(50).default([]),
  excludedPostIds: z.array(FacebookId).max(500).default([]),
});
export type FanpageSettings = z.infer<typeof FanpageSettings>;
export const FanpagePost = z.object({
  id: FacebookId,
  text: z.string().max(12000),
  permalink: z.string().max(2000),
  media: z
    .array(z.object({ title: z.string().max(500), description: z.string().max(2000) }))
    .max(10),
  fetchedAt: z.iso.datetime(),
});
export type FanpagePost = z.infer<typeof FanpagePost>;
export const FanpageContext = FanpagePost.extend({
  pageId: FacebookId,
  commentId: FacebookId,
  parentText: z.string().max(4000),
});
export type FanpageContext = z.infer<typeof FanpageContext>;
export const FanpageActionKind = z.enum(['public_reply', 'private_reply', 'hide', 'unhide']);
export type FanpageActionKind = z.infer<typeof FanpageActionKind>;
export const FanpageAction = z.object({
  id: z.uuid(),
  kind: FanpageActionKind,
  status: z.enum(['pending', 'sent', 'failed', 'unknown', 'cancelled']),
  text: z.string(),
  reason: z.string(),
  externalId: z.string().nullable(),
  actorId: z.string().nullable().default(null),
  recipientId: z.string().nullable().default(null),
  failureCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type FanpageAction = z.infer<typeof FanpageAction>;
export const FanpageComment = z.object({
  id: z.uuid(),
  connectionId: z.uuid(),
  postId: FacebookId,
  commentId: FacebookId,
  parentId: FacebookId.nullable(),
  authorId: z.string(),
  text: z.string(),
  occurredAt: z.iso.datetime(),
  version: z.string(),
  deleted: z.boolean(),
  needsReview: z.boolean(),
  context: FanpageContext.nullable(),
  actions: z.array(FanpageAction),
});
export type FanpageComment = z.infer<typeof FanpageComment>;
export const FanpageManualAction = z
  .object({
    kind: FanpageActionKind,
    text: z.string().trim().max(2000).default(''),
    requestId: z.uuid(),
  })
  .refine((v) => !v.kind.endsWith('reply') || v.text.length > 0, 'Reply text is required');
export type FanpageManualAction = z.infer<typeof FanpageManualAction>;
