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
      'electron-shell/**',
      'e2e/**',
      'src/**/*.js',
      'src/vite-env.d.ts',
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
  }
)
