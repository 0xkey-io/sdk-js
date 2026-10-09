import { TextDecoder, TextEncoder } from "node:util";

// jsdom omits these, and @0xkey-io/core needs them at import time.
Object.assign(globalThis, { TextEncoder, TextDecoder });
