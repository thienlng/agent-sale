import type { FactStore, ProjectionStore } from '../../domain/ports/projection.js';

/** Without a database there is nothing to project (unit tests, DB-less local runs). */
export class UnavailableProjectionStore implements ProjectionStore {
  async withLease<T>(): Promise<T | null> {
    return null;
  }
  async health() {
    return { watermarkId: 0, watermarkAt: null, lagSeconds: 0 };
  }
  async readWorkspace() {
    return [];
  }
  async deleteFacts() {}
}

export class UnavailableFactStore implements FactStore {
  async append() {
    return 0;
  }
}
