// Ported from D:\Dev\tensi-backend\eslint.config.mjs, adapted to this app's
// own tsconfig.json and to Vitest (instead of Jest) globals in test files.
import { FlatCompat } from '@eslint/eslintrc';
import { importX } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sonarjs from 'eslint-plugin-sonarjs';
import security from 'eslint-plugin-security';
import noSecrets from 'eslint-plugin-no-secrets';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
});

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '**/*.config.js', '**/*.config.mjs', '**/*.config.cjs'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: {
      sonarjs,
      security,
      'no-secrets': noSecrets,
    },
  },
  {
    ...unicorn.configs.recommended,
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'unicorn/prevent-abbreviations': [
        'error',
        {
          checkFilenames: false,
          allowList: { E2e: true, e2e: true, Dto: true, dto: true, req: true, res: true },
        },
      ],
    },
  },
  {
    ...importX.flatConfigs.recommended,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  },
  {
    ...importX.flatConfigs.typescript,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  },
  ...compat
    .config({
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      plugins: ['@typescript-eslint', 'prettier', 'n'],
      extends: [
        'standard',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/stylistic',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'plugin:@typescript-eslint/stylistic-type-checked',
        'plugin:n/recommended',
        'plugin:prettier/recommended',
      ],
      rules: {
        curly: ['error', 'all'],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/strict-boolean-expressions': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/return-await': ['error', 'always'],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          {
            prefer: 'type-imports',
            fixStyle: 'inline-type-imports',
          },
        ],
        '@typescript-eslint/naming-convention': [
          'error',
          {
            selector: 'interface',
            format: ['PascalCase'],
            prefix: ['I'],
          },
          {
            selector: 'typeAlias',
            format: ['PascalCase'],
          },
          {
            selector: 'class',
            format: ['PascalCase'],
          },
          {
            selector: 'variable',
            format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          },
          {
            selector: 'function',
            format: ['camelCase'],
          },
          {
            selector: 'enumMember',
            format: ['UPPER_CASE'],
          },
        ],
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        'padding-line-between-statements': [
          'error',
          {
            blankLine: 'always',
            prev: ['const', 'let', 'var'],
            next: ['return', 'throw'],
          },
          {
            blankLine: 'always',
            prev: 'expression',
            next: ['return', 'throw'],
          },
          {
            blankLine: 'always',
            prev: '*',
            next: 'if',
          },
        ],
        '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],
        '@typescript-eslint/member-ordering': [
          'error',
          {
            classes: [
              'public-instance-field',
              'public-static-field',
              'public-constructor',
              'public-instance-method',
              'public-static-method',
              'public-instance-get',
              'public-static-get',
              'public-instance-set',
              'public-static-set',
              'protected-instance-field',
              'protected-static-field',
              'protected-constructor',
              'protected-instance-method',
              'protected-static-method',
              'protected-instance-get',
              'protected-static-get',
              'protected-instance-set',
              'protected-static-set',
              'private-instance-field',
              'private-static-field',
              'private-constructor',
              'private-instance-method',
              'private-static-method',
              'private-instance-get',
              'private-static-get',
              'private-instance-set',
              'private-static-set',
            ],
          },
        ],
        'no-return-assign': 'error',
        'sonarjs/no-small-switch': 'error',

        'sonarjs/cognitive-complexity': ['warn', 15],
        'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],

        'security/detect-object-injection': 'error',
        'security/detect-eval-with-expression': 'error',
        'security/detect-non-literal-fs-filename': 'error',
        'security/detect-non-literal-regexp': 'error',
        'security/detect-child-process': 'error',
        'no-secrets/no-secrets': 'error',

        'no-restricted-syntax': [
          'error',
          {
            selector: 'ImportExpression',
            message: 'Do not use dynamic import(). All imports must be declared at the top of the file.',
          },
        ],

        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
            alphabetize: { order: 'asc', caseInsensitive: true },
            'newlines-between': 'always',
          },
        ],

        // eslint-plugin-n's resolver isn't TypeScript-aware (it looks for the
        // literal extensionless path on disk), so it false-positives on every
        // relative import in this project. import-x (configured with the
        // typescript resolver below) already covers unresolved-import
        // checking correctly, and `tsc`/nest build catches real missing
        // modules at compile time.
        'n/no-missing-import': 'off',
      },
      env: {
        node: true,
        es2022: true,
      },
    })
    .map((config) => ({ ...config, files: ['src/**/*.ts', 'test/**/*.ts'] })),
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
  },
  {
    files: ['src/**/*.spec.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      'n/no-extraneous-import': 'off',
      'n/no-unpublished-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'no-secrets/no-secrets': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'unicorn/prevent-abbreviations': 'off',
    },
  },
];
