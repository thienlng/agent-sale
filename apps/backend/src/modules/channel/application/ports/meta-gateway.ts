import type { MetaProvider } from '@agent-sales/contracts';
import type { GrantedAccount } from './channel-store.js';
export interface MetaGateway {
  configured(provider: MetaProvider): boolean;
  authorize(provider: MetaProvider, state: string): string;
  exchange(provider: MetaProvider, code: string): Promise<GrantedAccount[]>;
  subscribe(provider: MetaProvider, account: GrantedAccount): Promise<void>;
  /**
   * Stops Meta from sending this app the page's webhooks (T-133). Best effort for the caller:
   * rejects on any failure, and a provider without a matching endpoint resolves without a request.
   */
  unsubscribe(
    provider: MetaProvider,
    account: Pick<GrantedAccount, 'externalId' | 'token'>,
  ): Promise<void>;
}
export const META_GATEWAY = Symbol('META_GATEWAY');
