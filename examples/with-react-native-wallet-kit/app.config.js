const { applyNativeIdentity } = require("./native-identity");

module.exports = ({ config }) => applyNativeIdentity(config, process.env);
