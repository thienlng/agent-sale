import { z } from 'zod';

/** Money: integer VND (docs/05 conventions). */
export const Money = z.number().int().min(0).max(1_000_000_000_000);
