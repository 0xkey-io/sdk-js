/** @type {import("@jest/types").Config.InitialOptions} */
const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  moduleNameMapper: {
    "^@0xkey-io/internal-codec$": "<rootDir>/../../internal/codec/src/index.ts",
    "^@0xkey-io/internal-crypto-core$":
      "<rootDir>/../../internal/crypto-core/src/index.ts",
  },
  testPathIgnorePatterns: [
    "<rootDir>/dist/",
    "<rootDir>/node_modules/",
    "<rootDir>/src/__tests__/shared.ts",
  ],
  testTimeout: 30 * 1000, // For Github CI machines. Locally tests are quite fast.
  setupFilesAfterEnv: ["./jest.setup.ts"],
};

module.exports = config;
