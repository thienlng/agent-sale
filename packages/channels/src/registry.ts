import type { ChannelAdapter, ChannelKind } from './adapter.js';

export class ChannelRegistry {
  readonly #adapters = new Map<ChannelKind, ChannelAdapter>();

  register(adapter: ChannelAdapter): this {
    if (this.#adapters.has(adapter.kind))
      throw new Error(`adapter already registered: ${adapter.kind}`);
    this.#adapters.set(adapter.kind, adapter);
    return this;
  }

  get(kind: ChannelKind): ChannelAdapter {
    const a = this.#adapters.get(kind);
    if (!a) throw new Error(`no adapter for channel: ${kind}`);
    return a;
  }

  kinds(): ChannelKind[] {
    return [...this.#adapters.keys()];
  }
}
