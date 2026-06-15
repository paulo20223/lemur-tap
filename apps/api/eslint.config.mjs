// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/**', '*.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        ecmaVersion: 'latest',
      },
    },
    rules: {
      // NestJS relies heavily on decorators and DI metadata; keep the
      // ruleset pragmatic so it does not fight the framework idioms.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
