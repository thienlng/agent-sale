import { z } from 'zod';
export const FacebookId = z
  .string()
  .regex(/^[0-9]+(?:_[0-9]+)?$/)
  .max(200);
export const FanpageSettings = z.object({
  publicReplies: z.boolean().default(false),
  privateReplies: z.boolean().default(false),
  hideComments: z.boolean().default(false),
  hideKeywords: z.array(z.string().trim().min(3).max(80)).max(50).default([]),
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
    /** The comment version the staff member saw; a newer edit refuses the action (additive). */
    version: z.string().max(200).optional(),
    /** Staff confirmed a public reply that contains a phone number or email. */
    confirmPublicContact: z.boolean().default(false),
  })
  .refine((v) => !v.kind.endsWith('reply') || v.text.length > 0, 'Reply text is required');
export type FanpageManualAction = z.infer<typeof FanpageManualAction>;

/**
 * Query for stored received comments. Without any field the endpoint keeps its original
 * behaviour (newest 100); with one, it pages by `limit` (default 30) over the whole stored set.
 */
export const FanpageCommentListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** Opaque; bound to the Page, post filter and search text it was issued for. */
  cursor: z.string().min(1).max(2000).optional(),
  postId: FacebookId.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type FanpageCommentListQuery = z.infer<typeof FanpageCommentListQuery>;
export const FanpageCommentPage = z.object({
  data: z.array(FanpageComment),
  nextCursor: z.string().nullable(),
});
export type FanpageCommentPage = z.infer<typeof FanpageCommentPage>;
/** A stored comment read without side effects, with its stored parent comment when known. */
export const FanpageCommentDetail = z.object({
  data: FanpageComment,
  parent: z
    .object({ commentId: FacebookId, authorId: z.string(), text: z.string(), deleted: z.boolean() })
    .nullable(),
});
export type FanpageCommentDetail = z.infer<typeof FanpageCommentDetail>;
/** A fresh, read-only Facebook lookup of a comment's post and thread; nothing is stored. */
export const FanpageCommentSource = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('fresh'),
    post: FanpagePost,
    parentText: z.string().max(4000),
    commentText: z.string().max(4000),
    /** False when Facebook's current text or author differs from the stored record. */
    matchesStored: z.boolean(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['reconnect', 'permission', 'missing', 'mismatch', 'provider']),
  }),
]);
export type FanpageCommentSource = z.infer<typeof FanpageCommentSource>;
/** A post known from stored comments, so posts outside Facebook's latest-50 list stay selectable. */
export const FanpageCommentPost = z.object({
  postId: FacebookId,
  comments: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime(),
  /** Post text from the newest stored source snapshot, when one was captured. */
  text: z.string().max(12000).nullable(),
  permalink: z.string().max(2000).nullable(),
});
export type FanpageCommentPost = z.infer<typeof FanpageCommentPost>;
export const FanpageCommentPostsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(1000).optional(),
});
export type FanpageCommentPostsQuery = z.infer<typeof FanpageCommentPostsQuery>;
export const FanpageCommentPostPage = z.object({
  data: z.array(FanpageCommentPost),
  nextCursor: z.string().nullable(),
});
export type FanpageCommentPostPage = z.infer<typeof FanpageCommentPostPage>;
