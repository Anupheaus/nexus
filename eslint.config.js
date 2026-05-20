import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  tsPlugin.configs['flat/eslint-recommended'],
  ...tsPlugin.configs['flat/recommended'],

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      quotes: ['error', 'single', { avoidEscape: true }],
      indent: ['error', 2, { SwitchCase: 1 }],
      'max-len': ['warn', { code: 210 }],
      'arrow-parens': ['error', 'as-needed'],
      'prefer-const': ['error', { destructuring: 'all' }],
      'max-classes-per-file': 'error',
      'no-console': 'warn',
      'no-alert': 'warn',
      'no-unused-labels': 'error',
      'sort-imports': 'off',
      'no-unused-vars': 'off',
      'no-shadow': 'off',
      'no-unused-expressions': 'off',
      'no-inner-declarations': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-shadow': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];
