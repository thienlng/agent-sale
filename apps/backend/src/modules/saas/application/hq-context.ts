import { localDate, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';

/** `RAPIZ_HQ_WORKSPACE_ID`, or null when the HQ sync is off. */
export const HQ_WORKSPACE = Symbol('HQ_WORKSPACE');

export interface HqTarget {
  ws: WorkspaceId;
  /** Calendar date of an instant in the HQ business's timezone. */
  toDate: (iso: string) => string;
}

/**
 * Resolves the HQ business once: it must exist and sell SaaS, otherwise the sync stays off (and
 * says so once, by code).
 */
@Injectable()
export class HqContext {
  #target: Promise<HqTarget | null> | undefined;

  constructor(
    @Inject(HQ_WORKSPACE) private readonly hq: WorkspaceId | null,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  get configured(): boolean {
    return this.hq !== null;
  }

  /** Null when off or misconfigured. A lookup failure is retried on the next call. */
  target(): Promise<HqTarget | null> {
    if (!this.hq) return Promise.resolve(null);
    const ws = this.hq;
    this.#target ??= this.workspaces.getById(ws).then(
      (w) => {
        if (w.industry !== 'saas') return null;
        return { ws, toDate: (iso: string) => localDate(new Date(iso), w.timezone) };
      },
      (e: unknown) => {
        this.#target = undefined;
        throw e;
      },
    );
    return this.#target;
  }
}
