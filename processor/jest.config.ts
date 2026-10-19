/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['./test/jest.setup.ts'],
  roots: ['./test'],
  collectCoverage: true,
  coverageProvider: 'v8',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  // @commercetools/connect-payments-sdk@1.2.x pulls in jose (via jwks-rsa@4) as an
  // ESM-only package. Whitelist it for transformation (everything else in node_modules
  // stays ignored) and down-compile its .js to CommonJS so the CJS Jest runner can load
  // the SDK's security module.
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { isolatedModules: true, tsconfig: { allowJs: true, module: 'CommonJS' } }],
  },
};
