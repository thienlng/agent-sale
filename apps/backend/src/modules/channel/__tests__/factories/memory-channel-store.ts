import type { WorkspaceId } from '@agent-sales/shared';
import type { MetaProvider } from '@agent-sales/contracts';
import type {
  ChannelStore,
  ConnectionRecord,
  OAuthFlow,
} from '../../application/ports/channel-store.js';
import { ChannelError } from '../../domain/channel.errors.js';
export class MemoryChannelStore implements ChannelStore {
  readonly records = new Map<string, ConnectionRecord>();
  readonly flows = new Map<string, OAuthFlow>();
  async list(ws: WorkspaceId) {
    return [...this.records.values()].filter((c) => c.workspaceId === ws);
  }
  async get(ws: WorkspaceId, id: string) {
    const c = this.records.get(id);
    return c?.workspaceId === ws ? c : null;
  }
  async update(ws: WorkspaceId, id: string, patch: Parameters<ChannelStore['update']>[2]) {
    const c = await this.get(ws, id);
    if (!c) return null;
    const changed = { ...c, ...patch };
    this.records.set(id, changed);
    return changed;
  }
  async createFlow(f: OAuthFlow) {
    this.flows.set(f.id, structuredClone(f));
  }
  async consumeState(provider: MetaProvider, stateHash: string, browserHash: string) {
    const f = [...this.flows.values()].find(
      (row) =>
        row.provider === provider &&
        row.stateHash === stateHash &&
        row.browserHash === browserHash &&
        row.accountsSealed === null &&
        row.expiresAt.getTime() > Date.now(),
    );
    if (!f) return null;
    this.flows.delete(f.id);
    return f;
  }
  async discovery(ws: WorkspaceId, userId: string, id: string) {
    const f = this.flows.get(id);
    return f &&
      f.workspaceId === ws &&
      f.userId === userId &&
      f.accountsSealed &&
      f.expiresAt.getTime() > Date.now()
      ? f
      : null;
  }
  async select(ws: WorkspaceId, userId: string, id: string, accounts: ConnectionRecord[]) {
    const f = await this.discovery(ws, userId, id);
    if (!f) throw new ChannelError('NOT_FOUND', 'Discovery missing');
    for (const c of accounts) {
      if (
        [...this.records.values()].some(
          (row) =>
            row.provider === c.provider &&
            row.externalId === c.externalId &&
            row.workspaceId !== ws,
        )
      )
        throw new ChannelError('CONFLICT', 'Already connected');
    }
    this.flows.delete(id);
    for (const c of accounts) this.records.set(c.id, c);
    return accounts;
  }
  async claimEvents() {
    return [];
  }
  async renewEvent() {
    return true;
  }
  async completeEvent() {}
}
