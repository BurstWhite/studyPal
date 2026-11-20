/**
 * The phone cannot keep a timer running in the background, so ZJU data is
 * refreshed when the app opens or comes back to the foreground, at most once
 * every two hours. Deadline reminders do not depend on this: they are alarms
 * in the system calendar.
 */
import { getDb } from "@studypal/core/db";
import { warmModelLists } from "@studypal/core/llm/models";
import { accountStatus, syncNow } from "@studypal/core/routes/zju";
import { useEffect } from "react";
import { AppState } from "react-native";

const SYNC_INTERVAL_MS = 2 * 60 * 60_000;

/** `sync_log.finished_at` is SQLite's `datetime('now')`, in UTC. */
function parseFinishedAt(value: string): number {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso).getTime();
}

function lastSyncedAt(): number {
  const { lastSync } = accountStatus(getDb());
  const times = [lastSync.timetable, lastSync.exams, lastSync.assignments]
    .filter((entry) => entry !== null)
    .map((entry) => parseFinishedAt(entry.finishedAt));
  return times.length > 0 ? Math.max(...times) : 0;
}

function syncIfStale(): void {
  if (Date.now() - lastSyncedAt() < SYNC_INTERVAL_MS) return;
  syncNow().catch((error) => console.warn("sync failed:", error));
}

export function useForegroundSync(): void {
  useEffect(() => {
    syncIfStale();
    warmModelLists(getDb());
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") syncIfStale();
    });
    return () => subscription.remove();
  }, []);
}
