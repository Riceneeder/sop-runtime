import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['node_modules', 'bun.lock', 'dist'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.bun,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      'import/no-default-export': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          'selector': "ImportDeclaration[importKind='type']",
          'message': 'Use regular imports instead of import type, per Google TypeScript Style Guide.'
        },
        {
          'selector': "ImportSpecifier[importKind='type']",
          'message': 'Use regular imports instead of inline type imports, per Google TypeScript Style Guide.'
        },
        {
          'selector': 'TSImportType',
          'message': 'Use regular imports instead of import type, per Google TypeScript Style Guide.'
        }
      ]
    },
  },
];
