import { Injectable } from '@nestjs/common';

import type { BrainTodayRegistry, CareTodaySource } from '../api/brain-today.js';

/** Holds the care module's Today source once it registered (see `BRAIN_TODAY_REGISTRY`). */
@Injectable()
export class TodayExtensions implements BrainTodayRegistry {
  care: CareTodaySource | null = null;

  registerCare(source: CareTodaySource): void {
    this.care = source;
  }
}
