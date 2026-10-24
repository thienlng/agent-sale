import type { MetaProvider } from '@agent-sales/contracts';
import type { GrantedAccount } from './channel-store.js';
export interface MetaGateway {
  configured(provider: MetaProvider): boolean;
  authorize(provider: MetaProvider, state: string): string;
  exchange(provider: MetaProvider, code: string): Promise<GrantedAccount[]>;
  subscribe(provider: MetaProvider, account: GrantedAccount): Promise<void>;
}
export const META_GATEWAY = Symbol('META_GATEWAY');
