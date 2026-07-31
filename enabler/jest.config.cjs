// CommonJS config: enabler package.json declares "type": "module", so a .cjs file
// is required for Jest to load this config (a .ts/.js with module.exports fails to parse).
// ts-jest transpiles test/source .ts to CommonJS (isolatedModules) so Jest runs without
// experimental ESM VM modules.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['./test/jest.setup.ts'],
  roots: ['./test'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // isolatedModules is inherited from the enabler tsconfig.
        tsconfig: {
          module: 'CommonJS',
          esModuleInterop: true,
          allowJs: true,
        },
      },
    ],
  },
};
