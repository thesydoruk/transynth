/**
 * Database suite: `*.db.test.ts` files that run SQL against a real Postgres.
 *
 *   npm run test:db:up   # throwaway Postgres from docker/compose.test-db.yml
 *   npm run test:db
 *
 * Kept out of `npm test` so the unit suite needs no database. Runs in band:
 * every file shares one database, emptied before each test.
 */
import base from './jest.config.js';

/** @type {import('jest').Config} */
const config = {
  ...base,
  testMatch: ['**/__tests__/**/*.db.test.ts'],
  testPathIgnorePatterns: base.testPathIgnorePatterns.filter((p) => !p.includes('db')),
  moduleFileExtensions: [...base.moduleFileExtensions, 'mjs'],
  globalSetup: '<rootDir>/src/testing/dbGlobalSetup.mjs',
  setupFiles: ['<rootDir>/src/testing/dbTestEnv.ts', ...base.setupFiles],
  testTimeout: 30_000,
};

export default config;
