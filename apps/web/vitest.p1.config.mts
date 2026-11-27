// Quality P1 (component-level verification), component C6: the purchase button (PurchaseAction).
// Separate from `npm test` (which only includes src/**). Run with `npm run test:p1 --workspace=@aforo/web`.
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const reports = '../../quality/reports/c6';

export default defineConfig({
  resolve: { alias: { '@': path.join(import.meta.dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['test/p1/**/*.test.tsx'],
    setupFiles: ['test/p1/setup.ts'],
    // Inside a Stryker sandbox only the console reporter runs (no JUnit file next to the sandbox).
    reporters: process.env.STRYKER_MUTATOR_WORKER ? ['default'] : ['verbose', ['junit', { outputFile: `${reports}/junit.xml`, suiteName: 'C6 purchase action' }]],
    coverage: {
      provider: 'istanbul',
      include: ['src/components/purchase-action.tsx'],
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      reportsDirectory: `${reports}/coverage`,
    },
  },
});
