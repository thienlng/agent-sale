/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports are almost always a wrong abstraction (docs/ARCHITECTURE.md §2).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'module-public-api-only',
      severity: 'error',
      comment:
        'Other modules may import only modules/<x>/api/**. Call the facade or consume its events (docs/ARCHITECTURE.md §2).',
      from: { path: '^apps/backend/src/modules/([^/]+)/' },
      to: {
        path: '^apps/backend/src/modules/(?!$1/)[^/]+/',
        // api/ is the contract; <name>.module.ts imports are Nest DI wiring (see next rule).
        pathNot: [
          '^apps/backend/src/modules/[^/]+/api/',
          '^apps/backend/src/modules/[^/]+/[^/]+\\.module\\.ts$',
        ],
      },
    },
    {
      name: 'module-wiring-only-from-module-files',
      severity: 'error',
      comment:
        "Only a <name>.module.ts may import another module's <name>.module.ts (Nest imports: [...]). Everything else goes through api/.",
      from: {
        path: '^apps/backend/src/modules/([^/]+)/',
        pathNot: '^apps/backend/src/modules/[^/]+/[^/]+\\.module\\.ts$',
      },
      to: { path: '^apps/backend/src/modules/(?!$1/)[^/]+/[^/]+\\.module\\.ts$' },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'domain/ imports only packages/shared. No Nest, Drizzle, BullMQ, Fastify, db, queue, ai-core.',
      from: { path: '^apps/backend/src/modules/[^/]+/domain/' },
      to: {
        path: '(^|/)(node_modules/)?(@nestjs|drizzle-orm|bullmq|fastify|ioredis)(/|$)|^packages/(db|queue|ai-core|channels)/',
      },
    },
    {
      name: 'domain-does-not-import-upwards',
      severity: 'error',
      comment: 'domain/ must not import application/, infrastructure/ or interface/.',
      from: { path: '^apps/backend/src/modules/([^/]+)/domain/' },
      to: { path: '^apps/backend/src/modules/$1/(application|infrastructure|interface)/' },
    },
    {
      name: 'application-does-not-import-infra-or-interface',
      severity: 'error',
      comment:
        'application/ depends on domain + ports; infrastructure implements ports and is bound in the module file.',
      from: { path: '^apps/backend/src/modules/([^/]+)/application/', pathNot: '\\.spec\\.ts$' },
      to: { path: '^apps/backend/src/modules/$1/(infrastructure|interface)/' },
    },
    {
      name: 'interface-imports-application-only',
      severity: 'error',
      comment:
        'interface/http is thin: it may import application/ (handlers, facade) and api/, never domain internals or infrastructure.',
      from: { path: '^apps/backend/src/modules/([^/]+)/interface/' },
      to: { path: '^apps/backend/src/modules/$1/(domain|infrastructure)/' },
    },
    {
      name: 'db-only-from-infrastructure',
      severity: 'error',
      comment:
        '@agent-sales/db is imported only by infrastructure/ and tests (withTenant lives there).',
      from: {
        path: '^apps/backend/src/',
        pathNot:
          '/(infrastructure|__tests__)/|^apps/backend/src/common/db/|\\.spec\\.ts$|/[^/]+\\.module\\.ts$',
      },
      to: { path: '^packages/db/' },
    },
    {
      name: 'llm-only-from-ai-core',
      severity: 'error',
      comment: 'LLM provider SDKs are called only inside packages/ai-core (ADR-005).',
      from: { pathNot: '^packages/ai-core/' },
      to: { path: 'node_modules/(openai|@anthropic-ai|@google/genai|ai)(/|$)' },
    },
    {
      name: 'apps-do-not-import-apps',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/(?!$1/)' },
    },
    {
      name: 'web-imports-allowed-packages-only',
      severity: 'error',
      comment: 'The SPA may import only contracts, shared, ui and i18n from packages/.',
      from: { path: '^apps/web/' },
      to: { path: '^packages/(?!(contracts|shared|ui|i18n)/)' },
    },
    {
      name: 'web-features-do-not-import-each-other',
      severity: 'error',
      comment:
        'Compose features in routes/, never import across features (docs/ARCHITECTURE.md §4).',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/(?!$1/)' },
    },
    {
      name: 'web-shared-does-not-import-features',
      severity: 'error',
      from: { path: '^apps/web/src/(components|hooks|lib|stores|utils)/' },
      to: { path: '^apps/web/src/(features|routes|app)/' },
    },
    {
      name: 'testing-package-not-in-production-code',
      severity: 'error',
      from: { pathNot: '\\.(spec|test)\\.tsx?$|/__tests__/|/testing/|^packages/testing/' },
      to: { path: '^packages/testing/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules|\\.turbo|coverage)/|routeTree\\.gen\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
