import type { SaasRequestDto, SaasRequestKind } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** What the bot's built-in `builtin.saas.request` tool did (ADR-014 §3). */
export type BotSaasRequestResult =
  | { outcome: 'created' | 'updated' | 'unchanged'; request: SaasRequestDto }
  /** Staff already work on it: the bot says it is being handled, nothing changed. */
  | { outcome: 'in_progress'; request: SaasRequestDto }
  /** Playground: validated, nothing written. */
  | { outcome: 'preview'; request: null }
  | { outcome: 'invalid'; request: null; problems: string[] };

/** PUBLIC CONTRACT of the saas module. Use-case shaped, returns DTOs from packages/contracts. */
export interface SaasFacade {
  /**
   * Records (or fills in) the demo/trial/consultation request a customer made in a bot
   * conversation. One request per conversation and kind; `details` is the raw tool argument
   * object. `preview` validates without writing. Never throws for bad arguments: `invalid`.
   */
  recordBotRequest(
    workspaceId: WorkspaceId,
    input: {
      conversationId: string;
      contactId: string | null;
      kind: SaasRequestKind;
      details: unknown;
      preview: boolean;
    },
  ): Promise<BotSaasRequestResult>;
}

export const SAAS_FACADE = Symbol('SAAS_FACADE');
