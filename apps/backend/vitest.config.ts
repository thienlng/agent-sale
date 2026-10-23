import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // NestJS uses legacy decorators; providers are injected by explicit tokens
    // (no emitDecoratorMetadata needed at test time — see docs/ARCHITECTURE.md).
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
