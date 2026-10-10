import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { getClientParams, OtpType, ZeroXKeyClient } from "@0xkey-io/core";
import CaptchaChallenge from "./CaptchaChallenge";

const authProxyUrl = process.env.EXPO_PUBLIC_AUTH_PROXY_URL;
const configId = process.env.EXPO_PUBLIC_CONFIG_ID;
const organizationId = process.env.EXPO_PUBLIC_ORGANIZATION_ID;
const contact = process.env.EXPO_PUBLIC_TEST_EMAIL;
const origin = process.env.EXPO_PUBLIC_CAPTCHA_ORIGIN;
const validOrigin =
  origin === "https://captcha.staging.0xkey.io" ||
  origin === "https://captcha.0xkey.io"
    ? origin
    : null;
const validConfigId =
  !!configId &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    configId,
  );

function newTransactionId(): string {
  return Array.from(Crypto.getRandomBytes(16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export default function App() {
  const [transactionId, setTransactionId] = useState(newTransactionId);
  const activeAttempt = useRef(transactionId);
  const [status, setStatus] = useState("Initializing Core client…");
  const [ready, setReady] = useState(false);
  const [clientParams, setClientParams] = useState<
    | { phase: "loading" | "off" | "error" }
    | { phase: "enabled"; siteKey: string }
  >({ phase: "loading" });
  const client = useMemo(
    () =>
      authProxyUrl && validConfigId && organizationId
        ? new ZeroXKeyClient({
            authProxyUrl,
            authProxyConfigId: configId,
            organizationId,
          })
        : null,
    [],
  );

  useEffect(() => {
    if (!client) return;
    let mounted = true;
    void client.init().then(
      () => {
        if (mounted) {
          setReady(true);
          setStatus("Reading current client params…");
        }
      },
      () => {
        if (mounted) setStatus("Core initialization failed.");
      },
    );
    return () => {
      mounted = false;
    };
  }, [client]);

  useEffect(() => {
    if (!ready || !validConfigId || !authProxyUrl) return;
    let current = true;
    setClientParams({ phase: "loading" });
    setStatus("Reading current client params…");
    void getClientParams(configId!, authProxyUrl).then(
      (params) => {
        if (!current || activeAttempt.current !== transactionId) return;
        if (params.turnstileSiteKey) {
          setClientParams({
            phase: "enabled",
            siteKey: params.turnstileSiteKey,
          });
          setStatus("Complete the challenge to start OTP.");
        } else {
          setClientParams({ phase: "off" });
          setStatus("Captcha is off for this configuration. Start OTP.");
        }
      },
      () => {
        if (!current || activeAttempt.current !== transactionId) return;
        setClientParams({ phase: "error" });
        setStatus("Client params unavailable. Start a new attempt to retry.");
      },
    );
    return () => {
      current = false;
    };
  }, [ready, transactionId]);

  const onToken = useCallback(
    async (captchaToken: string) => {
      if (activeAttempt.current !== transactionId) return;
      if (!client || !contact) throw new Error("Client unavailable");
      // The opaque token exists only in this call, never in URL/state/logs.
      await client.initOtp({ otpType: OtpType.Email, contact, captchaToken });
      if (activeAttempt.current === transactionId) {
        setStatus("OTP started. This attempt is complete.");
      }
    },
    [client, transactionId],
  );
  const onFailure = useCallback(() => {
    if (activeAttempt.current === transactionId) {
      setStatus("Challenge stopped. Start a new attempt.");
    }
  }, [transactionId]);

  if (
    !validOrigin ||
    !validConfigId ||
    !organizationId ||
    !contact ||
    !authProxyUrl
  ) {
    return (
      <View style={styles.container}>
        <Text>
          Set the public test values in .env before running this sample.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.heading}>
        Captcha RN development build
      </Text>
      <Text>{status}</Text>
      <Button
        title="Start a new attempt"
        onPress={() => {
          const nextTransactionId = newTransactionId();
          activeAttempt.current = nextTransactionId;
          setClientParams({ phase: "loading" });
          setStatus("Reading current client params…");
          setTransactionId(nextTransactionId);
        }}
      />
      {ready && clientParams.phase === "off" && (
        <Button
          title="Start OTP"
          onPress={() => {
            if (activeAttempt.current !== transactionId) return;
            setClientParams({ phase: "loading" });
            setStatus("Submitting protected request…");
            void client!
              .initOtp({ otpType: OtpType.Email, contact: contact! })
              .then(
                () => {
                  if (activeAttempt.current === transactionId) {
                    setStatus("OTP started. This attempt is complete.");
                  }
                },
                () => {
                  if (activeAttempt.current === transactionId) {
                    setStatus("OTP failed. Start a new attempt to refresh.");
                  }
                },
              );
          }}
        />
      )}
      {ready && clientParams.phase === "enabled" && (
        <CaptchaChallenge
          key={transactionId}
          origin={validOrigin}
          configId={configId!}
          siteKey={clientParams.siteKey}
          transactionId={transactionId}
          onToken={onToken}
          onFailure={onFailure}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, gap: 16 },
  heading: { fontSize: 20, fontWeight: "bold" },
});
