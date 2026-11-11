import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CalendarEntry } from "../server/calendar/store";
import type { Assignment } from "../server/routes/assignments";
import type { StudyBlock } from "../server/routes/study";
import { cn } from "../lib/utils";
import { api, useQuery } from "./api";
import {
  addDays,
  formatTime,
  startOfDay,
  weekdayLabel,
} from "./calendar/dates";
import { planPrompt, queuePrompt } from "./chat/pendingPrompt";
import { describeRemaining } from "./DeadlinesPage";
import { PageHeader } from "./PageHeader";

const HOUR_MS = 3_600_000;
/** Assignments due within this long are listed. */
const DUE_SOON_MS = 48 * HOUR_MS;
/** Exams this far ahead are listed. */
const EXAM_LOOKAHEAD_DAYS = 14;

/** One row of today's timeline: an event or a study block. */
type Item =
  | { kind: "event"; start: Date; end: Date; entry: CalendarEntry }
  | { kind: "block"; start: Date; end: Date; block: StudyBlock };

const range = (from: Date, to: Date) =>
  `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

function sourceLabel(source: string): string {
  if (source === "exam") return "考试";
  return source === "manual" ? "日程" : "课程";
}

/** "还有 25 分钟" / "还有 2 小时 10 分钟". */
function untilText(target: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.round((target.getTime() - now.getTime()) / 60_000),
  );
  if (minutes < 60) return `还有 ${minutes} 分钟`;
  return `还有 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function formatDay(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekdayLabel(date)}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function TodayPage() {
  // Re-render each minute so "now" and the countdowns stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dayStart = useMemo(() => startOfDay(now), [now.toDateString()]);
  const dayEnd = addDays(dayStart, 1);
  const examEnd = addDays(dayStart, EXAM_LOOKAHEAD_DAYS);

  const today = useQuery<CalendarEntry[]>(
    `/api/events?${range(dayStart, dayEnd)}`,
  );
  const ahead = useQuery<CalendarEntry[]>(
    `/api/events?${range(dayStart, examEnd)}`,
  );
  const blocks = useQuery<StudyBlock[]>(
    `/api/study-blocks?${range(dayStart, dayEnd)}`,
  );
  const assignments = useQuery<Assignment[]>("/api/assignments");
  const [problem, setProblem] = useState<string>();

  const error =
    today.error ?? ahead.error ?? blocks.error ?? assignments.error ?? problem;
  const loaded = today.data && blocks.data && assignments.data;

  const allDay = (today.data ?? []).filter((entry) => entry.allDay);
  const items: Item[] = [
    ...(today.data ?? [])
      .filter((entry) => !entry.allDay)
      .map((entry): Item => ({
        kind: "event",
        start: new Date(entry.start),
        end: new Date(entry.end),
        entry,
      })),
    ...(blocks.data ?? []).map((block): Item => ({
      kind: "block",
      start: new Date(block.start),
      end: new Date(block.end),
      block,
    })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const current = items.find((item) => item.start <= now && item.end > now);
  const next = items.find((item) => item.start > now);

  const dueSoon = (assignments.data ?? []).filter(
    (item) =>
      item.status === "open" &&
      item.dueAt !== null &&
      new Date(item.dueAt).getTime() - now.getTime() <= DUE_SOON_MS,
  );
  const exams = (ahead.data ?? []).filter(
    (entry) => entry.source === "exam" && new Date(entry.end) > now,
  );

  const toggleBlock = async (block: StudyBlock) => {
    setProblem(undefined);
    try {
      await api(`/api/study-blocks/${block.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !block.done }),
      });
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
    blocks.reload();
  };

  const title = (item: Item) =>
    item.kind === "event" ? item.entry.title : item.block.title;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="今天" description={formatDay(now)} />

      {error && (
        <p role="alert" className="-mt-2 text-sm text-destructive">
          无法读取数据：{error}
        </p>
      )}

      {loaded && (
        <div className="rounded-lg border p-4">
          {current ? (
            <>
              <div className="text-sm text-muted-foreground">正在进行</div>
              <div className="mt-1 text-xl font-semibold">{title(current)}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                到 {formatTime(current.end)} 结束
                {current.kind === "event" && current.entry.location
                  ? ` · ${current.entry.location}`
                  : ""}
                {next
                  ? ` · 之后是 ${formatTime(next.start)} 的${title(next)}`
                  : ""}
              </div>
            </>
          ) : next ? (
            <>
              <div className="text-sm text-muted-foreground">
                接下来 · {untilText(next.start, now)}
              </div>
              <div className="mt-1 text-xl font-semibold">{title(next)}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {formatTime(next.start)}–{formatTime(next.end)}
                {next.kind === "event" && next.entry.location
                  ? ` · ${next.entry.location}`
                  : ""}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {items.length === 0 ? "今天没有安排。" : "今天的安排都结束了。"}
            </div>
          )}
        </div>
      )}

      <Section title="今天的安排">
        {allDay.length > 0 && (
          <p className="mb-2 text-sm text-muted-foreground">
            全天：{allDay.map((entry) => entry.title).join("、")}
          </p>
        )}
        {loaded && items.length === 0 ? (
          <Empty>今天没有课程、日程或学习块。</Empty>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const past = item.end <= now;
              const done = item.kind === "block" && item.block.done;
              return (
                <li
                  key={
                    item.kind === "event"
                      ? `e${item.entry.id}-${item.entry.start}`
                      : `b${item.block.id}`
                  }
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5",
                    past && !done && "opacity-60",
                  )}
                >
                  <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatTime(item.start)}–{formatTime(item.end)}
                  </span>
                  {item.kind === "block" ? (
                    <input
                      type="checkbox"
                      aria-label={`${item.block.title} 已完成`}
                      checked={item.block.done}
                      onChange={() => void toggleBlock(item.block)}
                      className="size-4 shrink-0"
                    />
                  ) : (
                    // Keeps titles aligned with the rows that have a checkbox.
                    <span className="size-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "truncate text-sm font-medium",
                        done && "text-muted-foreground line-through",
                      )}
                    >
                      {title(item)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.kind === "block"
                        ? [
                            "学习块",
                            item.block.course,
                            item.block.assignmentTitle,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : [sourceLabel(item.entry.source), item.entry.location]
                            .filter(Boolean)
                            .join(" · ")}
                    </div>
                  </div>
                  {item === current && (
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs">
                      进行中
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="48 小时内到期的作业">
        {assignments.data && dueSoon.length === 0 ? (
          <Empty>48 小时内没有到期的作业。</Empty>
        ) : (
          <ul className="divide-y rounded-lg border">
            {dueSoon.map((item) => {
              const remaining = describeRemaining(item.dueAt!, now);
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {item.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.course ?? "未归类"}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm tabular-nums",
                      remaining.urgent && "font-medium text-destructive",
                    )}
                  >
                    {remaining.text}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => queuePrompt(planPrompt(item))}
                  >
                    <Sparkles />
                    生成计划
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {exams.length > 0 && (
        <Section title={`未来 ${EXAM_LOOKAHEAD_DAYS} 天的考试`}>
          <ul className="divide-y rounded-lg border">
            {exams.map((exam) => {
              const start = new Date(exam.start);
              const days = Math.round(
                (startOfDay(start).getTime() - dayStart.getTime()) /
                  (24 * HOUR_MS),
              );
              return (
                <li
                  key={`${exam.id}-${exam.start}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {exam.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        `${formatDay(start)} ${formatTime(start)}–${formatTime(new Date(exam.end))}`,
                        exam.location,
                        exam.notes,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">
                    {days === 0 ? "今天" : days === 1 ? "明天" : `${days} 天后`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
