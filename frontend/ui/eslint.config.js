import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const securityRules = {
  'no-console': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-restricted-globals': [
    'error',
    { name: 'localStorage', message: 'Token e chiavi non vanno mai in web storage.' },
    { name: 'sessionStorage', message: 'Token e chiavi non vanno mai in web storage.' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'window', property: 'localStorage', message: 'Vietato.' },
    { object: 'window', property: 'sessionStorage', message: 'Vietato.' },
    { object: 'document', property: 'cookie', message: 'Gestito dal server.' },
    { object: 'document', property: 'write', message: 'Sink XSS vietato.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message: 'Sink XSS vietato (Trusted Types attivi in CSP).',
    },
    {
      selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
      message: 'Sink XSS vietato (Trusted Types attivi in CSP).',
    },
  ],
};

export default defineConfig([
  globalIgnores(['node_modules/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  { files: ['src/**/*.{ts,tsx}'], rules: securityRules },
]);
