import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { ZeroXKeyProvider } from "@0xkey-io/react-native-wallet-kit";
import { ZEROXKEY_CONFIG, ZEROXKEY_CALLBACKS } from "@/constants/0xkey";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { AuthState, useZeroXKey } from "@0xkey-io/react-native-wallet-kit";

function AuthGate() {
  const { authState } = useZeroXKey();
  const isLoggedIn = authState === AuthState.Authenticated;
  return (
    <Stack>
      <Stack.Protected guard={isLoggedIn}>
        <Stack.Screen name="(main)" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: "modal", title: "Modal" }}
        />
      </Stack.Protected>

      <Stack.Protected guard={!isLoggedIn}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="otp" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <ZeroXKeyProvider config={ZEROXKEY_CONFIG} callbacks={ZEROXKEY_CALLBACKS}>
        <AuthGate />
        <StatusBar style="auto" />
      </ZeroXKeyProvider>
    </ThemeProvider>
  );
}
