/** @type {import("@jest/types").Config.InitialOptions} */
module.exports = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  setupFilesAfterEnv: ["./jest.setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
};
