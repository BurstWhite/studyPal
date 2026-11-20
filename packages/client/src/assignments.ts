/** How deadlines are described, shared by both apps. */

const HOUR_MS = 3_600_000;

/** How far away a deadline is, in words. */
export function describeRemaining(
  dueAt: string,
  now: Date,
): { text: string; urgent: boolean } {
  const remaining = new Date(dueAt).getTime() - now.getTime();
  if (remaining <= 0) return { text: "已截止", urgent: true };
  const hours = remaining / HOUR_MS;
  if (hours < 1)
    return {
      text: `还剩 ${Math.max(1, Math.round(hours * 60))} 分钟`,
      urgent: true,
    };
  if (hours < 48)
    return { text: `还剩 ${Math.round(hours)} 小时`, urgent: hours <= 24 };
  return { text: `还剩 ${Math.floor(hours / 24)} 天`, urgent: false };
}

/** Pill color for a deadline: red when urgent, amber within a week. */
export function remainingTone(
  dueAt: string,
  now: Date,
): "danger" | "warn" | "neutral" {
  if (describeRemaining(dueAt, now).urgent) return "danger";
  const days = (new Date(dueAt).getTime() - now.getTime()) / (24 * HOUR_MS);
  return days <= 7 ? "warn" : "neutral";
}

export function formatDue(dueAt: string): string {
  return new Date(dueAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const WEEK_MS = 7 * 24 * HOUR_MS;

/** The fields the lists below look at. */
interface Listed {
  title: string;
  course: string | null;
  dueAt: string | null;
  status: "open" | "done" | "dismissed";
}

/** Whether an item matches a search for its title or course. */
export function matchesQuery(item: Listed, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    item.title.toLowerCase().includes(needle) ||
    (item.course ?? "").toLowerCase().includes(needle)
  );
}

/**
 * Assignments sorted into the lists both apps show: by status, and the open
 * ones by how soon they are due.
 */
export function assignmentLists<T extends Listed>(all: T[], now: number) {
  const due = (item: T) =>
    item.dueAt === null ? Infinity : new Date(item.dueAt).getTime();
  const open = all.filter((item) => item.status === "open");
  return {
    open,
    thisWeek: open.filter((item) => due(item) - now <= WEEK_MS),
    done: all.filter((item) => item.status === "done"),
    dismissed: all.filter((item) => item.status === "dismissed"),
    overdue: open.filter((item) => due(item) <= now),
    soon: open.filter((item) => due(item) > now && due(item) - now <= WEEK_MS),
    later: open.filter(
      (item) => due(item) - now > WEEK_MS && item.dueAt !== null,
    ),
    undated: open.filter((item) => item.dueAt === null),
  };
}
