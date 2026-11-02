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
    // ADR-023 guard (SB3-237: widened from the SB3-236 webhook files to the whole processor source).
    // Never let a raw Stripe or commercetools error reach the Connect logs. A stripe-node `StripeError`
    // exposes `raw` / `payment_intent` / `setup_intent` / `charge` / `payload` as own-enumerable props
    // (→ `client_secret`, bank-transfer IBAN/BIC) and keeps `message` non-enumerable, so `{ error }` /
    // `log.x(msg, error)` / `JSON.stringify(error)` leak secrets and drop the message; a commercetools
    // 400 body can echo address PII. Pass the error through `redactError(...)` from `src/utils.ts`, which
    // returns a fixed, log-safe whitelist (name/message/code/statusCode/httpErrorStatus/type/requestId/
    // decline_code/param/doc_url, plus a redacted `.cause`) without mutating the live error.
    files: ['**/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Positional whole-error argument, e.g. `log.error('msg', error)` / `log.error(id, err)`.
          // `>` restricts to a DIRECT argument so the `error` inside `redactError(error)` is never flagged.
          selector: "CallExpression[callee.object.name='log'] > Identifier[name=/^(e|err|error)$/]",
          message:
            'Do not pass a raw caught error to `log.*` — wrap it: `log.x(msg, { error: redactError(error) })` (ADR-023 / SB3-237).',
        },
        {
          // A log property whose VALUE is a bare error identifier: `{ error }`, `{ error: e }`,
          // `{ err: error }`, `{ cause: error }`, `{ error: authTransitionError }`. The key set is
          // error/err/e/cause and the value must be a bare Identifier — `{ error: redactError(e) }`
          // (a CallExpression value) is intentionally NOT matched.
          selector:
            "CallExpression[callee.object.name='log'] Property[key.name=/^(error|err|e|cause)$/][value.type='Identifier']",
          message:
            'Do not log a raw error field — use `{ error: redactError(error) }` from src/utils.ts (ADR-023 / SB3-237).',
        },
        {
          // Spreading a caught error into a log object, e.g. `{ ...error }`.
          selector: "CallExpression[callee.object.name='log'] SpreadElement[argument.name=/^(e|err|error)$/]",
          message:
            'Do not spread a raw caught error into a log object — use `{ error: redactError(error) }` (ADR-023 / SB3-237).',
        },
        {
          selector:
            "CallExpression[callee.object.name='log'] CallExpression[callee.object.name='JSON'][callee.property.name='stringify'][arguments.0.name=/^(e|err|error)$/]",
          message:
            'Do not JSON.stringify a caught error into a log — use `{ error: redactError(error) }` (ADR-023 / SB3-237).',
        },
      ],
    },
  },
];
