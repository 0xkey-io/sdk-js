"use client";

import React, { useState } from "react";

import { useZeroXKey } from "./0xkey-provider"; // Import useZeroXKey from 0xkey-provider
import { Button } from "./ui/button";
import { Email } from "@/lib/0xkey";
import { Input } from "./ui/input";
import { useWallet } from "@solana/wallet-adapter-react";

const SignUp: React.FC = () => {
  const { connected } = useWallet();
  const [email, setEmail] = useState("");
  const { createSubOrg } = useZeroXKey();

  if (!connected) {
    return null;
  }
  const handleSignUp = async () => {
    if (email) {
      try {
        await createSubOrg(email as Email);
      } catch (error) {
        console.error("Failed to create sub organization:", error);
      }
    }
  };

  return (
    <div>
      <Input
        placeholder="Enter your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button onClick={handleSignUp}>Sign Up</Button>
    </div>
  );
};

export default SignUp;
