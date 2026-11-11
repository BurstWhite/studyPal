/** Light, dark, or whatever the system is using. Kept in the browser's storage. */
import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "studypal.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

export function readTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system"; // storage unavailable
  }
}

/** Whether the page should be dark for a setting and the system's preference. */
export function resolvesToDark(theme: Theme, systemIsDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && systemIsDark);
}

/** Puts the theme on the page. The stylesheet keys everything off `.dark`. */
export function applyTheme(theme: Theme): void {
  const dark = resolvesToDark(theme, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Applies the saved theme and keeps following the system while the setting
 * is "system". Call once at startup; returns a function that stops following.
 */
export function startTheme(): () => void {
  applyTheme(readTheme());
  const media = window.matchMedia(DARK_QUERY);
  const onChange = () => applyTheme(readTheme());
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The current setting and a way to change it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const change = (next: Theme) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Without storage the choice still applies until the app closes.
    }
    setTheme(next);
  };
  return [theme, change];
}
