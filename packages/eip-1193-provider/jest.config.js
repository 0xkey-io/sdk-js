const config = {
  transform: {
    "\\.[jt]sx?$": "@0xkey-io/jest-config/transformer.js",
  },
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
  transformIgnorePatterns: ["<rootDir>/node_modules/(?!viem/)"],
  setupFiles: ["dotenv/config"],
  testTimeout: 30 * 1000, // For slow CI machines
};

module.exports = config;
