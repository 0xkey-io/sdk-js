import { useContext } from "react";
import { ClientContext, ClientContextType } from "../providers/Types";

export const useZeroXKey = (): ClientContextType => {
  const context = useContext(ClientContext);
  if (!context) {
    throw new Error("useZeroXKey must be used within a ZeroXKeyProvider");
  }
  return context;
};
