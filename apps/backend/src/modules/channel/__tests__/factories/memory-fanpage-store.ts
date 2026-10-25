import { FanpageSettings, type FanpageComment } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type { FanpageStore } from '../../application/ports/fanpage-store.js';
export class MemoryFanpageStore implements FanpageStore {
  async privateComments(ws: WorkspaceId, id: string, recipientId: string) {
    return (await this.list(ws, id)).filter((c) =>
      c.actions.some(
        (a) => a.kind === 'private_reply' && a.status === 'sent' && a.recipientId === recipientId,
      ),
    );
  }
  blocked = false;
  async interrupted() {
    return this.blocked;
  }
  readonly records = new Map<string, FanpageComment>();
  readonly preferences = new Map<string, FanpageSettings>();
  async settings(ws: WorkspaceId, id: string) {
    return structuredClone(this.preferences.get(`${ws}/${id}`) ?? FanpageSettings.parse({}));
  }
  async saveSettings(ws: WorkspaceId, id: string, input: FanpageSettings) {
    this.preferences.set(`${ws}/${id}`, structuredClone(input));
  }
  async list(ws: WorkspaceId, id: string) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${ws}/${id}/`))
      .map(([, c]) => structuredClone(c));
  }
  async change<T>(
    ws: WorkspaceId,
    id: string,
    commentId: string,
    fn: (current: FanpageComment | null) => { comment: FanpageComment | null; result: T },
  ): Promise<T> {
    const key = `${ws}/${id}/${commentId}`,
      old = this.records.get(key),
      { comment, result } = fn(old ? structuredClone(old) : null);
    if (comment) this.records.set(key, structuredClone(comment));
    return result;
  }
}
