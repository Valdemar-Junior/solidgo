import { defineConfig } from 'vitest/config';

// Robo de LOGICA (Vitest): so os testes de src/**.test.ts.
// Os testes de TELA (Playwright, tests/e2e/**.spec.ts) NAO sao do Vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    environment: 'node',
  },
});
