import type { PlopTypes } from '@turbo/gen';

/**
 * `pnpm gen module <name>`  — backend module with the fixed shape (docs/ARCHITECTURE.md §2)
 * `pnpm gen feature <name>` — web feature folder mirroring a backend module (§4)
 * Scaffolding is deterministic on purpose: agents fill in behavior, never structure.
 */
export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setHelper('pascal', (s: string) =>
    s.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase()),
  );
  plop.setHelper('upper', (s: string) => s.replace(/-/g, '_').toUpperCase());

  plop.setGenerator('module', {
    description: 'Backend domain module (apps/backend/src/modules/<name>)',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'module name (kebab-case, singular, e.g. billing, crm, conversation):',
        validate: (v: string) => (/^[a-z][a-z0-9-]*$/.test(v) ? true : 'kebab-case only'),
      },
    ],
    actions: [
      {
        type: 'addMany',
        destination: '{{ turbo.paths.root }}/apps/backend/src/modules/{{name}}',
        base: 'templates/module',
        templateFiles: 'templates/module/**',
        globOptions: { dot: true },
      },
      () =>
        'Next: fill MODULE.md, add the module to apps/backend/src/app.module.ts and to docs/ARCHITECTURE.md §3, ' +
        'add packages/db/src/schema/<name>.ts + packages/contracts/src/<name>/ when it owns tables/DTOs.',
    ],
  });

  plop.setGenerator('feature', {
    description: 'Web feature folder (apps/web/src/features/<name>)',
    prompts: [{ type: 'input', name: 'name', message: 'feature name (= backend module name):' }],
    actions: [
      {
        type: 'addMany',
        destination: '{{ turbo.paths.root }}/apps/web/src/features/{{name}}',
        base: 'templates/feature',
        templateFiles: 'templates/feature/**',
        globOptions: { dot: true },
      },
    ],
  });
}
