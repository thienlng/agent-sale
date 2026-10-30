import type { SaasRequestKind } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** What the bot's built-in `builtin.saas.request` tool did (ADR-014 §3). */
export type BotSaasRequestResult =
  /** The customer (found or created by phone) carries the request as its status and a note. */
  | { outcome: 'recorded'; contactId: string; created: boolean }
  /** Playground: validated, nothing written. */
  | { outcome: 'preview' }
  | { outcome: 'invalid'; problems: string[] };

/** PUBLIC CONTRACT of the saas module. Use-case shaped, returns DTOs from packages/contracts. */
export interface SaasFacade {
  /**
   * Records the demo/trial/consultation request a customer made in a bot conversation on the
   * customer itself: found or created by phone, moved forward to "requested" (never back) and
   * given a note with the details. `details` is the raw tool argument object. `preview`
   * validates without writing. Never throws for bad arguments: `invalid`.
   */
  recordBotRequest(
    workspaceId: WorkspaceId,
    input: { kind: SaasRequestKind; details: unknown; preview: boolean },
  ): Promise<BotSaasRequestResult>;
}

export const SAAS_FACADE = Symbol('SAAS_FACADE');
