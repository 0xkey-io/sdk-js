/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  transform: {
    "^.+\\.m?tsx?$": "ts-jest",
  },
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["\\.node\\.test\\.ts$"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
