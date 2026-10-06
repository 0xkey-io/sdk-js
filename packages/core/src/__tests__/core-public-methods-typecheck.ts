import type {
  ZeroXKeyClient,
  ZeroXKeyClientMethods,
} from "../__clients__/core";

type Expect<T extends true> = T;
type InternalLifecycleMethod =
  | "retireAuthWrites"
  | "setAuthContextGuard"
  | "awaitAuthRetirement"
  | "awaitPendingAuthMutations"
  | "restrictPersistedCredentialsToNewSessions";

type CoreOwnsLifecycle = Expect<
  Exclude<InternalLifecycleMethod, keyof ZeroXKeyClient> extends never
    ? true
    : false
>;
type ConvenienceMethodsHideLifecycle = Expect<
  Extract<InternalLifecycleMethod, keyof ZeroXKeyClientMethods> extends never
    ? true
    : false
>;

export type CorePublicMethodContract = [
  CoreOwnsLifecycle,
  ConvenienceMethodsHideLifecycle,
];
