import { WebBoundCredentialStore } from "../../__storage__/web/bound-credential";
import { WebAtomicBoundSessionStore } from "../../__storage__/web/bound-session";

(globalThis as any).WebBoundCredentialStore = WebBoundCredentialStore;
(globalThis as any).WebAtomicBoundSessionStore = WebAtomicBoundSessionStore;
