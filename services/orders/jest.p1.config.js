// Quality P1 (component-level verification) for components C4 and C5. Separate from `npm test`.
// P1_COMPONENT picks the component so each one gets its own JUnit report and branch coverage:
//   P1_COMPONENT=c4 -> payment webhook processing (webhook.service.ts + webhook-signature.ts)
//   P1_COMPONENT=c5 -> gateway circuit breaker + retry (resilience.ts)
// Run with `npm run test:p1:c4` / `npm run test:p1:c5` in this workspace.
const COMPONENTS = {
  c4: {
    name: 'C4 payment webhook processing',
    files: ['src/payments/webhook.service.ts', 'src/payments/webhook-signature.ts'],
  },
  c5: {
    name: 'C5 gateway circuit breaker and retry',
    files: ['src/payments/resilience.ts'],
  },
};

const id = process.env.P1_COMPONENT;
const component = COMPONENTS[id];
if (!component) {
  throw new Error(`P1_COMPONENT must be one of ${Object.keys(COMPONENTS).join(', ')} (got "${id ?? ''}")`);
}
const reports = `<rootDir>/../../quality/reports/${id}`;

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  preset: 'ts-jest',
  testEnvironment: 'node',
  // src is a root too, so files no test imports still appear in the coverage table (as 0%).
  roots: ['<rootDir>/src', '<rootDir>/test/p1'],
  testMatch: [`<rootDir>/test/p1/${id}-*.test.ts`],
  transform: {
    '^.+.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }],
  },
  verbose: true,
  collectCoverageFrom: component.files,
  coverageDirectory: `${reports}/coverage`,
  coverageReporters: ['text', 'json-summary', 'lcov', 'html'],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: reports.replace('<rootDir>', __dirname),
        outputName: 'junit.xml',
        suiteName: component.name,
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
      },
    ],
  ],
};
