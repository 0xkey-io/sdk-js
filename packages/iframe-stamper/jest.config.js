/** @type {import("@jest/types").Config.InitialOptions} */
const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
};

module.exports = config;
