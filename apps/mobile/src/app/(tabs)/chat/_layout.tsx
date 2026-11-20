import { Stack } from "expo-router";
import { useColors } from "@/ui/theme";

export default function ChatStack() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.foreground },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ headerShown: false, title: "对话" }}
      />
      <Stack.Screen name="[id]" options={{ title: "对话" }} />
    </Stack>
  );
}
