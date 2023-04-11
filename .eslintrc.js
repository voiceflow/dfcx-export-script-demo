module.exports = {
  extends: ['@voiceflow/eslint-config'],
  ignorePatterns: ['build/**/*'],
  overrides: [
    {
      files: ['*.ts'],
      extends: ['@voiceflow/eslint-config/typescript'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      },
    },
  ],
};
