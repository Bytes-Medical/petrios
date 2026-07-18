/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ['@commitlint/config-conventional'],
  // Keep commitlint's standard exemptions for Git-generated merge commits,
  // reverts, and semantic version tags. Authored commits still follow the
  // Conventional Commits grammar.
  defaultIgnores: true,
  rules: {
    'scope-case': [2, 'always', 'lower-case'],
    'breaking-change-exclamation-mark': [2, 'always'],
  },
  helpUrl:
    'https://github.com/Bytes-Medical/petrios/blob/main/CONTRIBUTING.md#conventional-commits',
}

export default config
