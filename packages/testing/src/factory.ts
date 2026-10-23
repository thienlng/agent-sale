/**
 * Minimal factory helper (Fishery-style). Each module keeps its factories in
 * __tests__/factories and builds them with `defineFactory`.
 */
export interface Factory<T> {
  build(overrides?: Partial<T>): T;
  buildList(count: number, overrides?: Partial<T>): T[];
}

export function defineFactory<T>(defaults: (seq: number) => T): Factory<T> {
  let seq = 0;
  return {
    build(overrides = {}) {
      seq += 1;
      return { ...defaults(seq), ...overrides };
    },
    buildList(count, overrides = {}) {
      return Array.from({ length: count }, () => this.build(overrides));
    },
  };
}
