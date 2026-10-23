// @ts-check
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Architecture boundaries are enforced twice on purpose: here for instant
 * feedback in the editor/agent loop, and in .dependency-cruiser.cjs for the
 * full graph in CI (`pnpm arch`). Keep both in sync with docs/ARCHITECTURE.md.
 * Elements are folders (eslint-plugin-boundaries v7); `capture` extracts the
 * module/feature name so "same module" policies can be expressed with templates.
 */
const elements = [
  { type: 'be-api', pattern: 'apps/backend/src/modules/*/api', capture: ['module'] },
  { type: 'be-domain', pattern: 'apps/backend/src/modules/*/domain', capture: ['module'] },
  {
    type: 'be-application',
    pattern: 'apps/backend/src/modules/*/application',
    capture: ['module'],
  },
  {
    type: 'be-infrastructure',
    pattern: 'apps/backend/src/modules/*/infrastructure',
    capture: ['module'],
  },
  { type: 'be-interface', pattern: 'apps/backend/src/modules/*/interface', capture: ['module'] },
  { type: 'be-tests', pattern: 'apps/backend/src/modules/*/__tests__', capture: ['module'] },
  { type: 'be-common', pattern: 'apps/backend/src/common' },
  { type: 'web-features', pattern: 'apps/web/src/features/*', capture: ['feature'] },
  {
    type: 'web-shared',
    pattern: [
      'apps/web/src/components',
      'apps/web/src/hooks',
      'apps/web/src/lib',
      'apps/web/src/stores',
      'apps/web/src/utils',
    ],
  },
  { type: 'web-routes', pattern: ['apps/web/src/routes', 'apps/web/src/app'] },
];

const sameModule = (type) => ({
  element: { type, captured: { module: '{{ from.element.captured.module }}' } },
});
const any = (type) => ({ element: { type } });

const policies = [
  { from: any('be-domain'), allow: { to: [sameModule('be-domain')] } },
  {
    from: any('be-application'),
    allow: {
      // Other modules are reachable only through their api/ (facade + events).
      to: [sameModule('be-domain'), sameModule('be-application'), any('be-api'), any('be-common')],
    },
  },
  {
    from: any('be-infrastructure'),
    allow: {
      to: [
        sameModule('be-domain'),
        sameModule('be-application'),
        sameModule('be-infrastructure'),
        any('be-common'),
        any('be-api'),
      ],
    },
  },
  {
    from: any('be-interface'),
    allow: { to: [sameModule('be-application'), any('be-api'), any('be-common')] },
  },
  {
    from: any('be-tests'),
    allow: {
      to: [
        sameModule('be-api'),
        sameModule('be-domain'),
        sameModule('be-application'),
        sameModule('be-infrastructure'),
        sameModule('be-interface'),
        any('be-common'),
      ],
    },
  },
  { from: any('be-common'), allow: { to: [any('be-common')] } },
  {
    from: any('web-features'),
    allow: {
      to: [
        {
          element: {
            type: 'web-features',
            captured: { feature: '{{ from.element.captured.feature }}' },
          },
        },
        any('web-shared'),
      ],
    },
  },
  { from: any('web-shared'), allow: { to: [any('web-shared')] } },
  {
    from: any('web-routes'),
    allow: { to: [any('web-features'), any('web-shared'), any('web-routes')] },
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      '**/routeTree.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/ignore': ['**/*.spec.ts', '**/*.test.ts', '**/*.test.tsx'],
      // ESM imports use .js extensions for .ts sources; the TS resolver maps them.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Import not allowed by architecture boundaries (docs/ARCHITECTURE.md §2/§4): other modules only through their api/ (facade/events); respect the layer direction interface → application → domain; web features never import each other.',
          policies,
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/lib/api-client.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use api() from @/lib/api-client (docs/ARCHITECTURE.md §4).' },
      ],
    },
  },
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'packages/testing/**',
      'apps/*/test/**',
      '**/__tests__/**',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'turbo/generators/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
  prettier,
);
