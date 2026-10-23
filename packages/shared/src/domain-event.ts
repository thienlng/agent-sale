import type { WorkspaceId } from './ids.js';

/**
 * Domain events are raised inside aggregates and collected by the application
 * layer, which turns them into integration events (packages/contracts) written
 * to the transactional outbox. Keep them small and past-tense.
 */
export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  readonly name: TName;
  readonly workspaceId: WorkspaceId;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

/** Mixin for aggregates: collects events until the handler pulls them. */
export abstract class AggregateRoot {
  readonly #events: DomainEvent[] = [];

  protected raise(event: DomainEvent): void {
    this.#events.push(event);
  }

  /** Returns and clears pending events. Called once per command by the handler. */
  pullEvents(): DomainEvent[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return events;
  }
}
