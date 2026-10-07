// commitlint enforces the conventional-commit contract in CI and locally
// through the husky commit-msg hook. Severity 2 (Error) is used as a plain
// number instead of importing RuleConfigSeverity from '@commitlint/types':
// the enum adds an extra dependency for no behavioural difference.
//
// More detailed description: https://docs.exarh.ru/pages/viewpage.action?pageId=24510769

export default {
  extends: ['@commitlint/config-conventional'],
  helpUrl: 'https://docs.exarh.ru/pages/viewpage.action?pageId=24510769',
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build', // Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
        'chore', // Code maintenance (shifting JSON files)
        'ci', // Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
        'docs', // Documentation only changes
        'feat', // A new feature
        'fix', // A bug fix
        'perf', // A code change that improves performance
        'refactor', // A code change that neither fixes a bug nor adds a feature
        'revert', // Canceling changes
        'style', // Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
        'test', // Adding missing tests or correcting existing tests
      ],
    ],
    // AGENTS.md mandates a hard 100-character limit on commit headers.
    'header-max-length': [2, 'always', 100],
    // DCO is mandatory in AGENTS.md: every commit must carry the sign-off trailer.
    'signed-off-by': [2, 'always', 'Signed-off-by:'],
  },
}
