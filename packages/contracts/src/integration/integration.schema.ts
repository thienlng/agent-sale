import { z } from 'zod';

/** Point-of-sale / inventory systems a workspace can connect (ADR-017). Only KiotViet ships in PR 1. */
export const PmsProvider = z.enum(['kiotviet', 'sapo', 'haravan', 'pancake_pos']);
export type PmsProvider = z.infer<typeof PmsProvider>;

export const ConnectionStatus = z.enum(['connected', 'syncing', 'error', 'disconnected']);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const KiotVietSettings = z
  .object({
    /** Branches whose stock the bot sells from. */
    saleBranchIds: z.array(z.number().int().positive()).min(1).max(50),
    /** Branch that receives orders pushed from Rapiz; must be one of the sale branches. */
    orderBranchId: z.number().int().positive(),
    pushOrders: z.boolean(),
    syncCustomers: z.boolean(),
  })
  .refine((s) => s.saleBranchIds.includes(s.orderBranchId), {
    message: 'the order branch must be one of the sale branches',
    path: ['orderBranchId'],
  });
export type KiotVietSettings = z.infer<typeof KiotVietSettings>;

export const KiotVietCredentials = z.object({
  /** Raw input (name or store URL); the server extracts the retailer name. */
  retailer: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(500),
});
export type KiotVietCredentials = z.infer<typeof KiotVietCredentials>;

export const KiotVietBranch = z.object({
  id: z.number().int(),
  name: z.string(),
  address: z.string().nullable(),
});
export type KiotVietBranch = z.infer<typeof KiotVietBranch>;

export const KiotVietTestResponse = z.object({
  retailer: z.string(),
  branches: z.array(KiotVietBranch),
  /** What the first sync would do to the catalog. */
  preview: z.object({
    matched: z.number().int(),
    created: z.number().int(),
    rapizOnly: z.number().int(),
  }),
});
export type KiotVietTestResponse = z.infer<typeof KiotVietTestResponse>;

export const ConnectKiotVietRequest = KiotVietCredentials.extend({ settings: KiotVietSettings });
export type ConnectKiotVietRequest = z.infer<typeof ConnectKiotVietRequest>;

export const UpdateKiotVietRequest = z.object({
  settings: KiotVietSettings.optional(),
  /** New credentials after the shop rotated its client secret. */
  credentials: KiotVietCredentials.optional(),
  /** Optimistic-concurrency version of the connection being edited. */
  version: z.number().int(),
});
export type UpdateKiotVietRequest = z.infer<typeof UpdateKiotVietRequest>;

export const SyncProgress = z.object({
  phase: z.enum(['branches', 'categories', 'products', 'stock']),
  done: z.number().int(),
  total: z.number().int().nullable(),
});
export type SyncProgress = z.infer<typeof SyncProgress>;

/** A workspace's connection. Never carries the client secret or access token. */
export const ConnectionDto = z.object({
  id: z.uuid(),
  provider: z.literal('kiotviet'),
  status: ConnectionStatus,
  retailer: z.string(),
  clientIdMasked: z.string(),
  settings: KiotVietSettings,
  branches: z.array(KiotVietBranch),
  counts: z.object({
    products: z.number().int(),
    customers: z.number().int(),
    ordersPushed: z.number().int(),
  }),
  progress: SyncProgress.nullable(),
  lastSyncAt: z.iso.datetime().nullable(),
  lastError: z.object({ code: z.string(), at: z.iso.datetime() }).nullable(),
  version: z.number().int(),
});
export type ConnectionDto = z.infer<typeof ConnectionDto>;

export const IntegrationListResponse = z.object({
  providers: z.array(
    z.object({
      provider: PmsProvider,
      available: z.boolean(),
      connection: ConnectionDto.nullable(),
    }),
  ),
});
export type IntegrationListResponse = z.infer<typeof IntegrationListResponse>;

/** One sync log line: an i18n code plus params, never raw provider payloads. */
export const SyncLogEntry = z.object({
  id: z.uuid(),
  level: z.enum(['info', 'warning', 'error']),
  code: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  at: z.iso.datetime(),
});
export type SyncLogEntry = z.infer<typeof SyncLogEntry>;

export const SyncLogResponse = z.object({ entries: z.array(SyncLogEntry) });
export type SyncLogResponse = z.infer<typeof SyncLogResponse>;
