import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      'prisma/migrations/**',
      'storybook-static/**',
      '.storybook/**',
      'electron/**',
      'e2e/**',
      'src/**/*.js',
      '*.config.js',
      '*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    ...jsxA11y.flatConfigs.recommended,
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-duplicate-imports': 'error',
    },
  },
  {
    // Client (browser) tree. Everything under src/ EXCEPT the directories below,
    // which are server-only code that legitimately imports src/server/**, the
    // PHI vault, and Node builtins. Scoped by directory rather than a blanket
    // "everything outside src/server/**" because several server-only trees
    // (routes, webhooks, workers, vapi, outcome, carriers, practices, middleware)
    // live directly under src/ alongside client code — see vite.config.ts's
    // guardServerOnlyImports plugin for the build-time backstop that checks
    // the actual bundle graph instead of these path conventions.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/server/**',
      'src/routes/**',
      'src/webhooks/**',
      'src/workers/**',
      'src/vapi/**',
      'src/outcome/**',
      'src/carriers/**',
      'src/practices/**',
      'src/middleware/**',
      'src/pii-vault.ts',
      'src/services/pii-vault.ts',
      'src/services/guardrails/**',
      'src/services/analytics/**',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/**', '**/server'],
              message:
                'Client code must not import src/server/** — this drags Node-only code (crypto, Prisma) into the browser bundle. Move shared logic to a client-safe module instead.',
            },
            {
              group: ['**/pii-vault*'],
              message:
                'Client code must not import the PHI vault (pii-vault.ts) — it uses Node crypto and must stay server-only.',
            },
            {
              group: ['node:*'],
              message: 'Client code must not import Node builtins — they do not exist in the browser.',
            },
          ],
          paths: [
            'crypto',
            'fs',
            'path',
            'os',
            'child_process',
            'net',
            'dns',
            'tls',
            'http',
            'https',
            'stream',
            'dgram',
            'readline',
            'cluster',
          ].map((name) => ({
            name,
            message: 'Client code must not import Node builtins — they do not exist in the browser.',
          })),
        },
      ],
    },
  }
)
