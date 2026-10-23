import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { ApiError } from './api-error.js';

/**
 * Validates request bodies/queries/params against a contracts schema.
 * Usage: `@Body(new ZodValidationPipe(CreateWorkspaceRequest)) body: CreateWorkspaceRequest`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
