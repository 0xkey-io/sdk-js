import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getClientParams } from "@0xkey-io/core";

import { CaptchaChallenge } from "@/components/captcha/captcha-challenge";
import {
  CaptchaCancelledError,
  CaptchaUnavailableError,
  captchaTokenFor,
  type CaptchaSettings,
} from "@/constants/captcha";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

type Attempt = {
  transactionId: string;
  nonce: string;
  siteKey: string;
  resolve(token: string): void;
  reject(error: Error): void;
};

type CaptchaContextValue = {
  /**
   * Resolves undefined when Captcha is off for the Auth Proxy config, otherwise
   * the token of one fresh challenge. Rejects with CaptchaCancelledError when
   * the user cancels, the app goes to the background or the challenge fails.
   */
  requireCaptchaToken(): Promise<string | undefined>;
};

const CaptchaContext = createContext<CaptchaContextValue | null>(null);

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function CaptchaProvider({
  settings,
  children,
}: {
  settings: CaptchaSettings | null;
  children: ReactNode;
}) {
  const colors = Colors[useColorScheme() ?? "light"];
  const current = useRef<Attempt | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);

  const settle = useCallback((settled: Attempt, outcome: () => void) => {
    if (current.current !== settled) return;
    current.current = null;
    setAttempt(null);
    outcome();
  }, []);

  const challenge = useCallback(
    (siteKey: string) =>
      new Promise<string>((resolve, reject) => {
        if (!settings?.origin) {
          reject(new CaptchaUnavailableError("Captcha origin not configured"));
          return;
        }
        // Starting another protected action abandons the previous challenge.
        const previous = current.current;
        if (previous)
          settle(previous, () => previous.reject(new CaptchaCancelledError()));
        const next: Attempt = {
          transactionId: randomHex(16),
          nonce: randomHex(32),
          siteKey,
          resolve,
          reject,
        };
        current.current = next;
        setAttempt(next);
      }),
    [settings, settle],
  );

  const requireCaptchaToken = useCallback(async () => {
    if (!settings) return undefined;
    return captchaTokenFor(
      () => getClientParams(settings.authProxyConfigId, settings.authProxyUrl),
      challenge,
    );
  }, [settings, challenge]);

  useEffect(
    () => () => {
      current.current?.reject(new CaptchaCancelledError());
      current.current = null;
    },
    [],
  );

  const cancel = () => {
    const active = current.current;
    if (active)
      settle(active, () => active.reject(new CaptchaCancelledError()));
  };

  const value = useMemo(() => ({ requireCaptchaToken }), [requireCaptchaToken]);

  return (
    <CaptchaContext.Provider value={value}>
      {children}
      <Modal
        visible={attempt !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={cancel}
      >
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background }]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.primaryText }]}>
              Verify you are human
            </Text>
            <TouchableOpacity onPress={cancel} accessibilityRole="button">
              <Text style={[styles.cancel, { color: colors.tint }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
          {attempt && settings?.origin ? (
            <CaptchaChallenge
              key={attempt.transactionId}
              origin={settings.origin}
              configId={settings.authProxyConfigId}
              siteKey={attempt.siteKey}
              transactionId={attempt.transactionId}
              nonce={attempt.nonce}
              onToken={(token) => settle(attempt, () => attempt.resolve(token))}
              onStop={() =>
                settle(attempt, () =>
                  attempt.reject(new CaptchaCancelledError()),
                )
              }
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </CaptchaContext.Provider>
  );
}

export function useCaptcha(): CaptchaContextValue {
  const value = useContext(CaptchaContext);
  if (!value) throw new Error("useCaptcha must be used inside CaptchaProvider");
  return value;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: "600" },
  cancel: { fontSize: 16 },
});
