import { hash } from "./common.mjs";

function selection(decoded, authorization, owner, operation, wireSha256) {
  return { protocol: "mpp", method: decoded.challenge?.method ?? decoded.method, intent: decoded.challenge?.intent ?? decoded.intent, authorization, owner, operation, wireSha256 };
}

export function selectionFromChallenge(wire, response, owner) {
  const header = response.headers.get("www-authenticate");
  if (!header) throw new Error("MPP_AUTHORIZATION_CHALLENGE_REQUIRED");
  const decoded = wire.Challenge.fromResponse(response);
  return selection(decoded, null, owner, "challenge-decode", hash(header));
}

export function selectionFromCredential(wire, header, owner) {
  const decoded = wire.Credential.deserialize(header);
  return selection(decoded, decoded.payload.type, owner, "credential-decode", hash(header));
}
