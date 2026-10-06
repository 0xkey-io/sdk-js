// This OTP-only example does not configure WalletConnect. Core imports the
// optional wallet manager statically, so keep its unused dependency out of
// the Expo sample bundle. Any accidental use fails explicitly.
module.exports = {
  init() {
    throw new Error("WalletConnect is unavailable in this OTP-only example");
  },
};
