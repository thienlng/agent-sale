// Conventional Commits, enforced on commit-msg. See .agents/rules/02-git-and-pr.md
export default {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      // "Refs: T-012" / "Closes: T-012" footers and inline T-012 references
      issuePrefixes: ['T-'],
    },
  },
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'chore', 'docs', 'test', 'perf', 'ci', 'build', 'revert'],
    ],
    'scope-enum': [
      1,
      'always',
      [
        'repo',
        'docs',
        'ci',
        'todo',
        'api',
        'web',
        'webhook',
        'worker',
        'widget',
        'admin',
        'site',
        'shared',
        'db',
        'ai-core',
        'channels',
        'carriers',
        'payments',
        'billing',
        'ui',
        'i18n',
        'testing',
        'infra',
      ],
    ],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
    'subject-case': [2, 'always', 'lower-case'],
    // Every commit must reference a task: "Refs: T-012" or "Closes: T-012"
    'references-empty': [2, 'never'],
  },
};
