import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ProbeResult = z.object({
  name: z.string(),
  status: z.enum(['up', 'down', 'skipped']),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;

export const ReadinessResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(ProbeResult),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
