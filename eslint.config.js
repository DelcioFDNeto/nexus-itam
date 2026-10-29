import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'portal-colaborador/**', '**/node_modules/**']),
  {
    files: ['**/*.{js,jsx}', '!scripts/**', '!services/**'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Componentes referenciados so em JSX (ex.: `{ icon: Icon }`) nao sao
      // detectados sem eslint-plugin-react; PascalCase fica isento.
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^(_|[A-Z])' },
      ],
    },
  },
  {
    // Microsservicos Fastify, scripts de backend e testes de regras (Node.js).
    files: ['services/**/*.js', 'scripts/**/*.{js,mjs}', 'tests/**/*.js', 'vitest.rules.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' },
      ],
      // Sanitizacao defensiva remove caracteres de controle ASCII intencionalmente.
      'no-control-regex': 'off',
    },
  },
])
