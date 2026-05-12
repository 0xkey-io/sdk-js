/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  testTimeout: 120000, // 2 minutes for tests involving ZeroXKey API calls
  verbose: true,
};
