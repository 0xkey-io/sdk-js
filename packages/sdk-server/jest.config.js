/** @type {import("@jest/types").Config.InitialOptions} */
const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  testMatch: ["**/__tests__/**/*-(spec|test).[jt]s?(x)"],
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
  testTimeout: 30 * 1000, // For slow CI machines
};

module.exports = config;
