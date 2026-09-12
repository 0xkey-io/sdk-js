/** @type {import("@jest/types").Config.InitialOptions} */
const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  testMatch: ["**/__tests__/**/*-(spec|test).[jt]s?(x)"],
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
  testTimeout: 30 * 1000, // For slow CI machines
  setupFiles: ["<rootDir>/src/__polyfills__/jest.setup.webcrypto.ts"],
  moduleNameMapper: {
    "^@polyfills/(.*)$": "<rootDir>/src/__polyfills__/$1",
    "^@types$": "<rootDir>/src/__types__/index",
    "^@utils$": "<rootDir>/src/utils",
  },
};

module.exports = config;
