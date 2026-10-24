import { defineConfig } from 'vitest/config';

// Integration tests need Docker (Testcontainers). Run with `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
