import { ZeroXKeyClient } from "../../__clients__/core";
import { WebBoundCredentialStore } from "../../__storage__/web/bound-credential";

(globalThis as any).ZeroXKeyClient = ZeroXKeyClient;
(globalThis as any).WebBoundCredentialStore = WebBoundCredentialStore;
