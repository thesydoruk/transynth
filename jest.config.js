/**
 * `npm test` runs the suites one at a time in a single worker process with
 * `--workerIdleMemoryLimit`, not `--runInBand`: Jest's ESM runtime
 * (`--experimental-vm-modules`) keeps each finished suite's module registry
 * alive, about 13 MB per suite here, so one process for all 228 suites passed
 * the default 4 GB heap and died. The worker is restarted once it grows past
 * the limit, which bounds the run at ~1.5 GB however many suites are added.
 */
/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/games/registerForTests.ts'],
  roots: ['<rootDir>/src', '<rootDir>/worker/src', '<rootDir>/services/bethesda-tools'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // `*.db.test.ts` need a Postgres; they run with `npm run test:db` (jest.db.config.js).
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/', '\\.db\\.test\\.ts$'],
  collectCoverageFrom: [
    'src/**/*.ts',
    'worker/src/**/*.ts',
    '!src/**/__tests__/**/*.test.ts',
    '!worker/src/**/__tests__/**/*.test.ts',
    '!src/cli/**',
  ],
  coverageProvider: 'v8',
  clearMocks: true,
};

export default config;
