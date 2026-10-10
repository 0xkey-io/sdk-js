const CAPTCHA_PROTECTED_PATHS = Object.freeze([
  "/v1/otp_init",
  "/v1/otp_init_v2",
  "/v1/signup",
  "/v1/signup_v2",
]);

function validateCaptchaHeaderContract(swagger) {
  if (!swagger || !swagger.paths || typeof swagger.paths !== "object") {
    throw new Error("Captcha header route mismatch");
  }

  const declared = new Set();
  for (const [path, methods] of Object.entries(swagger.paths)) {
    const parameters = methods?.post?.parameters ?? [];
    if (!Array.isArray(parameters)) {
      throw new Error("Captcha header contract mismatch");
    }
    const matches = parameters.filter(
      (parameter) =>
        typeof parameter?.name === "string" &&
        parameter.name.toLowerCase() === "x-captcha-token",
    );
    if (matches.length === 0) continue;
    if (!CAPTCHA_PROTECTED_PATHS.includes(path)) {
      throw new Error("Captcha header route mismatch");
    }
    if (
      matches.length !== 1 ||
      matches[0].name !== "X-Captcha-Token" ||
      matches[0].in !== "header" ||
      matches[0].required !== false ||
      matches[0].type !== "string"
    ) {
      throw new Error("Captcha header contract mismatch");
    }
    declared.add(path);
  }

  if (
    declared.size !== CAPTCHA_PROTECTED_PATHS.length ||
    CAPTCHA_PROTECTED_PATHS.some((path) => !declared.has(path))
  ) {
    throw new Error("Captcha header route mismatch");
  }
  return [...CAPTCHA_PROTECTED_PATHS];
}

module.exports = { CAPTCHA_PROTECTED_PATHS, validateCaptchaHeaderContract };
