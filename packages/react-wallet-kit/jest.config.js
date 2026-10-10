/** @type {import("@jest/types").Config.InitialOptions} */
const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  moduleNameMapper: {
    "^\\./index\\.css$": "<rootDir>/src/tests/fixtures/index-style.cjs",
    "^@polyfills/(.*)$": "<rootDir>/../core/src/__polyfills__/$1",
    "^@types$": "<rootDir>/../core/src/__types__/index",
    "^@utils$": "<rootDir>/../core/src/utils",
  },
  testMatch: ["**/tests/**/*-(spec|test).[jt]s?(x)"],
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
  testTimeout: 30 * 1000, // For slow CI machines
};

module.exports = config;
