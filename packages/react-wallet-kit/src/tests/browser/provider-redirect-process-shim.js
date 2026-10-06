export const process = {
  env: { NODE_ENV: "production" },
  browser: true,
  version: "",
  versions: {},
  /** @param {() => void} callback */
  nextTick(callback) {
    queueMicrotask(callback);
  },
};
