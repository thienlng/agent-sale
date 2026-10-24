import { DomainError } from '@agent-sales/shared';

import type { ReadStore } from '../../domain/ports/read.js';
import type { FactStore, ProjectionStore } from '../../domain/ports/projection.js';

/** Without a database there is nothing to project (unit tests, DB-less local runs). */
export class UnavailableProjectionStore implements ProjectionStore {
  async withLease<T>(): Promise<T | null> {
    return null;
  }
  async health() {
    return { watermarkId: 0, watermarkAt: null, lagSeconds: 0 };
  }
}

export class UnavailableFactStore implements FactStore {
  async append() {
    return 0;
  }
}

class StatisticsUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Statistics need a configured database');
  }
}

/** Reading statistics without a database is an explicit error, never an empty result. */
export class UnavailableReadStore implements ReadStore {
  #fail(): never {
    throw new StatisticsUnavailableError();
  }
  totals(): never {
    return this.#fail();
  }
  series(): never {
    return this.#fail();
  }
  tagEvents(): never {
    return this.#fail();
  }
  currentTags(): never {
    return this.#fail();
  }
  statuses(): never {
    return this.#fail();
  }
  bySales(): never {
    return this.#fail();
  }
  byPage(): never {
    return this.#fail();
  }
  drilldown(): never {
    return this.#fail();
  }
}
