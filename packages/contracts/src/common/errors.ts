import { z } from 'zod';

/**
 * Error codes shared by API and clients. Add new codes here, never inline.
 * HTTP mapping lives in apps/backend/src/common/http/.
 */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'QUOTA_EXCEEDED',
  'FEATURE_LOCKED',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Error envelope returned by every API error response (docs/11 §2). */
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    traceId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
