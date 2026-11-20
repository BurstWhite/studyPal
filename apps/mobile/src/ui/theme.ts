/** The desktop app's palette (`styles/globals.css`), for React Native. */
import { useColorScheme } from "react-native";

const light = {
  background: "#f3f6f4",
  foreground: "#16211c",
  card: "#ffffff",
  primary: "#1b6e5a",
  primaryForeground: "#ffffff",
  secondary: "#e4efe9",
  secondaryForeground: "#14513f",
  muted: "#edf1ee",
  mutedForeground: "#63706a",
  border: "#dfe6e2",
  destructive: "#b83a2b",
  warn: "#8f5b0e",
  warnBackground: "#fbefd6",
  dangerBackground: "#f8e4df",
  exam: "#c2483a",
  course: "#d9824f",
  courseSoft: "#fcebdf",
  activity: "#4e9e74",
  activitySoft: "#e0f1e6",
  study: "#7e6cc8",
  studySoft: "#ece8f9",
  examSoft: "#f9e1dc",
};

const dark: typeof light = {
  background: "#111614",
  foreground: "#e4ebe7",
  card: "#171e1b",
  primary: "#5cc4a3",
  primaryForeground: "#0a1f18",
  secondary: "#1d3029",
  secondaryForeground: "#9fdcc7",
  muted: "#1d2521",
  mutedForeground: "#8d9a94",
  border: "#26302c",
  destructive: "#ee7c6b",
  warn: "#e6b665",
  warnBackground: "#362b16",
  dangerBackground: "#3b201c",
  exam: "#e8786a",
  course: "#e89a6b",
  courseSoft: "#382a20",
  activity: "#6cc08f",
  activitySoft: "#1c3125",
  study: "#a495e6",
  studySoft: "#29253e",
  examSoft: "#3d221f",
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 22 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
