/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    setupFiles: ['./test/jest.setup.ts'],
    moduleDirectories: ['src', 'node_modules'],
    roots: ['./test'],
    verbose: true,
    transform: {
        '^.+\\.ts?$': ['esbuild-jest', 'babel-jest', {
            tsconfig : './tsconfig.json'
        }]
    },
};