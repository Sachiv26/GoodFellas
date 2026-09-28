/**
 * Jest configuration (unit tests - no database required).
 * Pure-logic tests: validators, pricing engine, PDF mapping, auth tokens.
 */
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          module: 'commonjs',
          jsx: 'react-jsx',
          target: 'es2020',
          paths: undefined,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
};

export default config;
