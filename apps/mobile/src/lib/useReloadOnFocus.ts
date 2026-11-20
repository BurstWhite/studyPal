/**
 * Native tabs keep every screen mounted, from launch on, so a screen reloads
 * its data each time it comes into view (including the first time: it may
 * have been loaded long before, while another tab was showing).
 */
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

export function useReloadOnFocus(...reloads: (() => void)[]): void {
  useFocusEffect(
    useCallback(() => {
      for (const reload of reloads) reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, reloads),
  );
}

/** A message for a failed request. */
export const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
