import { requireOptionalNativeModule } from "expo";
import {
  openNativeBoundSessionStore,
  type NativeBoundSessionContext,
  type NativeBoundContextPort,
} from "./native-bound-context";

/** Explicit controlled-build opt-in. Core and the default RN adapter never import this. */
export async function openExpoNativeBoundSessionStore(
  targetKey: string,
  ownerId: string,
): Promise<NativeBoundSessionContext | null> {
  const port =
    requireOptionalNativeModule<NativeBoundContextPort>("OxkeyBoundContext");
  return openNativeBoundSessionStore(port, targetKey, ownerId);
}
