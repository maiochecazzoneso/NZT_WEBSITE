// vitest.config.ts — test di sicurezza (docs/architettura_sicurezza_nzt_solutions.md §7).
// "unit": logica isolata, nessun build richiesto. "integration": avvia il server di produzione sul build
// reale in dist/ (eseguire prima `pnpm build`).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
  '@server': fileURLToPath(new URL('./server', import.meta.url)),
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
