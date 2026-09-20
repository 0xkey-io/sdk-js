import type {
  AppleOauthProviderConfig,
  GoogleOauthProviderConfig,
  HandleAppleOauthParams,
  HandleDiscordOauthParams,
  HandleFacebookOauthParams,
  HandleGoogleOauthParams,
  HandleXOauthParams,
  OauthProviderConfig,
  ZeroXKeyProviderConfig,
} from "../index";

const legacyBoolean: OauthProviderConfig = true;
const legacyObject: OauthProviderConfig = {
  clientId: "legacy-client-id",
  redirectUri: "legacy://callback",
};

const googleProvider: GoogleOauthProviderConfig = {
  primaryClientId: { webClientId: "google-web-client-id" },
  secondaryClientIds: ["google-ios-client-id"],
  clientId: "deprecated-google-client-id",
};
const appleProvider: AppleOauthProviderConfig = {
  primaryClientId: {
    serviceId: "apple-service-id",
    iosBundleId: "apple-ios-bundle-id",
  },
  secondaryClientIds: ["apple-secondary-client-id"],
  clientId: "deprecated-apple-client-id",
};

const config: ZeroXKeyProviderConfig = {
  organizationId: "organization-id",
  auth: {
    oauth: {
      google: googleProvider,
      apple: appleProvider,
      facebook: {
        primaryClientId: "facebook-client-id",
        secondaryClientIds: ["facebook-secondary-client-id"],
        clientId: "deprecated-facebook-client-id",
      },
      x: {
        primaryClientId: "x-client-id",
        secondaryClientIds: ["x-secondary-client-id"],
      },
      discord: legacyBoolean,
    },
  },
};
const legacyConfig: ZeroXKeyProviderConfig = {
  organizationId: "organization-id",
  auth: { oauth: { google: legacyObject } },
};

const googleHandler: HandleGoogleOauthParams = {
  primaryClientId: { webClientId: "google-handler-client-id" },
  secondaryClientIds: [],
  clientId: "deprecated-google-handler-client-id",
  additionalState: { returnTarget: "home" },
};
const appleHandler: HandleAppleOauthParams = {
  primaryClientId: {
    serviceId: "apple-handler-service-id",
    iosBundleId: "apple.handler.bundle",
  },
  secondaryClientIds: [],
  clientId: "deprecated-apple-handler-client-id",
};
const facebookHandler: HandleFacebookOauthParams = {
  primaryClientId: "facebook-handler-client-id",
  secondaryClientIds: [],
  clientId: "deprecated-facebook-handler-client-id",
};
const xHandler: HandleXOauthParams = {
  primaryClientId: "x-handler-client-id",
  secondaryClientIds: [],
  clientId: "deprecated-x-handler-client-id",
};
const discordHandler: HandleDiscordOauthParams = {
  primaryClientId: "discord-handler-client-id",
  secondaryClientIds: [],
  clientId: "deprecated-discord-handler-client-id",
};

const wrongGoogle: ZeroXKeyProviderConfig = {
  organizationId: "organization-id",
  auth: {
    oauth: {
      // @ts-expect-error Google canonical primaryClientId must use webClientId.
      google: { primaryClientId: "not-an-object" },
    },
  },
};
const wrongApple: HandleAppleOauthParams = {
  // @ts-expect-error Apple canonical primaryClientId must separate service and bundle IDs.
  primaryClientId: "not-an-object",
};
const wrongFacebook: HandleFacebookOauthParams = {
  // @ts-expect-error Facebook canonical primaryClientId is a string.
  primaryClientId: { webClientId: "not-a-string" },
};

void [
  legacyBoolean,
  legacyObject,
  legacyConfig,
  config,
  googleHandler,
  appleHandler,
  facebookHandler,
  xHandler,
  discordHandler,
  wrongGoogle,
  wrongApple,
  wrongFacebook,
];
