// ESLint (flat config) per tutto il monorepo.
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const WEB_FILES = ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'];

/** Il bypass della RLS è consentito solo nei punti elencati più sotto (vedi CLAUDE.md). */
const SYSTEM_CONTEXT_RESTRICTION = {
  name: '@floral/db',
  importNames: ['withSystemContext'],
  message:
    'withSystemContext aggira la Row-Level Security: usalo solo nei moduli autorizzati (vedi CLAUDE.md § Tenancy).',
};

const PLATFORM_RESTRICTION = {
  name: '@floral/core/platform',
  message:
    'Le operazioni di piattaforma aggirano la RLS: solo CLI amministrativa, mai dal web (ADR-019).',
};

/** Le regole Next/React/a11y valgono solo per l'app web. */
const scopedToWeb = [...nextVitals, ...nextTs]
  .filter((config) => !(config.ignores && Object.keys(config).length === 1))
  .map((config) => ({ ...config, files: WEB_FILES }));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/db/src/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/e2e/.auth/**',
      'apps/web/e2e/.mail/**',
      'apps/web/.mail-sink/**',
    ],
  },
  ...scopedToWeb,
  { files: WEB_FILES, settings: { next: { rootDir: 'apps/web/' }, react: { version: 'detect' } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Promise non gestite: errori silenziosi nelle server action e nei servizi.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
      'no-restricted-imports': ['error', { paths: [SYSTEM_CONTEXT_RESTRICTION] }],
    },
  },
  {
    // Le operazioni di piattaforma (bypass RLS) si usano solo dalla CLI amministrativa,
    // mai da pagine o server action del web (vedi docs/DECISIONS.md, ADR-019).
    files: WEB_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [SYSTEM_CONTEXT_RESTRICTION, PLATFORM_RESTRICTION] },
      ],
    },
  },
  {
    // Punti autorizzati al contesto di sistema (bypass RLS) + test e seed.
    files: [
      'packages/db/**',
      'packages/core/src/audit.ts',
      'packages/core/src/context.ts',
      'packages/core/src/services/team.ts',
      'packages/core/src/platform/**',
      'packages/core/test/**',
      'apps/web/e2e/**',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
