// Quality P1 (component-level verification), component C2: reservation request validation.
// Separate from `npm test` (node:test); run with `npm run test:p1 --workspace=@aforo/inventory`.
import { defineConfig } from 'vitest/config';

const reports = '../../quality/reports/c2';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/p1/**/*.test.ts'],
    // Inside a Stryker sandbox only the console reporter runs (no JUnit file next to the sandbox).
    reporters: process.env.STRYKER_MUTATOR_WORKER ? ['default'] : ['verbose', ['junit', { outputFile: `${reports}/junit.xml`, suiteName: 'C2 reservation validation' }]],
    coverage: {
      provider: 'istanbul',
      include: ['src/reservations/validation.ts'],
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      reportsDirectory: `${reports}/coverage`,
    },
  },
});
