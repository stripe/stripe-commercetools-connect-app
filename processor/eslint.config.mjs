import typescriptEslint from '@typescript-eslint/eslint-plugin';
import jest from 'eslint-plugin-jest';
import prettier from 'eslint-plugin-prettier';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import eslintConfigPrettier from 'eslint-config-prettier';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  ...typescriptEslint.configs['flat/recommended'],
  eslintConfigPrettier,
  prettierRecommended,
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      jest,
      prettier,
      'unused-imports': unusedImports,
    },
    files: ['*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },

      parser: tsParser,
    },

    rules: {
      'no-redeclare': ['warn'],
      'no-console': ['error'],
      'no-unused-vars': 'off',
      'no-irregular-whitespace': 'warn',
      'unused-imports/no-unused-imports': 'error',

      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/no-unused-vars': ['warn'],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-var-requires': 'off',

      'sort-imports': [
        'error',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
        },
      ],
    },
  },
  {
    // ADR-023 guard: on the files hardened for the SB3-236 webhook log-leak, never let a raw
    // Stripe error reach the logs. A StripeError exposes payload / payment_intent / setup_intent as
    // own-enumerable props (→ client_secret), so log `errorMessage: error instanceof Error ?
    // error.message : String(error)` instead. Scoped to the files this PR fixed; the processor-wide
    // sweep is tracked separately.
    files: ['**/routes/stripe-payment.route.ts', '**/services/stripe-subscription.service.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='log'] Property[key.name='error']",
          message:
            'Do not log a raw `error` field — use `errorMessage: error instanceof Error ? error.message : String(error)` (ADR-023).',
        },
        {
          selector:
            "CallExpression[callee.object.name='log'] CallExpression[callee.object.name='JSON'][callee.property.name='stringify'][arguments.0.name=/^(e|err|error)$/]",
          message:
            'Do not JSON.stringify a caught error into a log — use `error instanceof Error ? error.message : String(error)` (ADR-023).',
        },
      ],
    },
  },
];
