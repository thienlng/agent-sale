import { z } from 'zod';

/** Cursor pagination query parameters used by every list endpoint. */
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

/** Wraps a list response: `{ data: T[], page: { nextCursor } }`. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.object({ nextCursor: z.string().nullable() }),
  });
}
