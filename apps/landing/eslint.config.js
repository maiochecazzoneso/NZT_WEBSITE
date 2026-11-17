import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', '.astro/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
]);
