// @ts-check
/**
 * Lint config focused on catching bugs, not style (formatting is left alone
 * to avoid a codebase-wide reformat). Rules that the existing code breaks
 * massively but that are not bugs (`any`, unused vars) are warnings so the
 * CI stays green while they get cleaned up over time.
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'dist/**', 'web/dist/**', 'prisma-client/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**', 'resources/**', '**/.wrangler/**', '.claude/**', '.harness/**', 'site/.cache/**', 'site/public/assets/site.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // The main process lazily require()s the generated Prisma client.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Accessibility (A11Y-1, task O): jsx-a11y "recommended" as errors (19/11/2026,
  // once the existing code was clean; exceptions are annotated in place).
  {
    files: ['src/**/*.tsx', 'web/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: Object.fromEntries(
      Object.entries(jsxA11y.flatConfigs.recommended.rules)
        .filter(([, v]) => (Array.isArray(v) ? v[0] : v) !== 'off')
        .map(([r, v]) => [r, Array.isArray(v) ? ['error', ...v.slice(1)] : 'error']),
    ),
  },
  {
    files: ['src/**/*.tsx', 'web/src/**/*.tsx'],
    rules: {
      // Every autoFocus in the app moves focus into a field the user just
      // opened (inline edit, dialog, sign-in form): the accepted use of it.
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  {
    files: ['**/scripts/**/*.mjs', '*.config.{js,ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  // Showcase site (site/): a Node build script, modules shared by the build and the browser, one browser entry.
  {
    files: ['site/*.mjs', 'site/src/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['site/src/client/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  // Must come last so these override the TypeScript presets above.
  {
    files: ['web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
