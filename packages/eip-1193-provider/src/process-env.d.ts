import { UUID } from "crypto";

export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      WALLET_ID: UUID;
      ORG_ID: UUID;
      ZEROXKEY_API_PUBLIC_KEY: string;
      ZEROXKEY_API_PRIVATE_KEY: string;
    }
  }
}
