/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/worker/src'],
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
  testPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/'],
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
