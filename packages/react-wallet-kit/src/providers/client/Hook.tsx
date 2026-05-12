"use client";

import { useContext } from "react";
import { ClientContext, ClientContextType } from "./Types";

/** @internal */
export const useZeroXKey = (): ClientContextType => {
  const context = useContext(ClientContext);
  if (!context)
    throw new Error("useZeroXKey must be used within ZeroXKeyProvider");
  return context;
};
