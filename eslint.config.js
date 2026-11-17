import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', '.astro/', 'coverage/', 'apps/', 'packages/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    // Codice eseguito da Node: server di produzione, test, file di configurazione
    files: ['server/**/*.mjs', 'tests/**/*.{ts,mjs}', '*.config.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
]);
