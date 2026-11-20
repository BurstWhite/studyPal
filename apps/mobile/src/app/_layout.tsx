import "@/platform/polyfills";
import { setUpPlatform } from "@/platform/setup";
import { useForegroundSync } from "@/lib/useForegroundSync";
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { NativeStackNavigationOptions } from "expo-router";
import { useColorScheme } from "react-native";

setUpPlatform();

const SHEET: NativeStackNavigationOptions = {
  presentation: "formSheet",
  // One height, so the sheet does not jump when the keyboard closes.
  sheetAllowedDetents: [0.92],
  sheetGrabberVisible: true,
};

export default function RootLayout() {
  const scheme = useColorScheme();
  useForegroundSync();
  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="assignment-new" options={SHEET} />
        <Stack.Screen name="provider-new" options={SHEET} />
        <Stack.Screen name="event-editor" options={SHEET} />
        <Stack.Screen name="block-editor" options={SHEET} />
      </Stack>
    </ThemeProvider>
  );
}
