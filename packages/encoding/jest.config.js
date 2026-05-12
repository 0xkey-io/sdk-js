/** @type {import("@jest/types").Config.InitialOptions} */
const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  moduleNameMapper: {
    "^@0xkey-io/internal-codec$": "<rootDir>/../../internal/codec/src/index.ts",
  },
  testPathIgnorePatterns: [
    "<rootDir>/dist/",
    "<rootDir>/node_modules/",
    "<rootDir>/src/__tests__/shared.ts",
  ],
  testTimeout: 30 * 1000, // For Github CI machines. Locally tests are quite fast.
};

module.exports = config;
