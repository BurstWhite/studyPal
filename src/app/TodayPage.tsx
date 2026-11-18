import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Clock,
  FileText,
  GraduationCap,
  MapPin,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CalendarEntry } from "../server/calendar/store";
import type { Assignment } from "../server/routes/assignments";
import type { Progress, StudyBlock } from "../server/routes/study";
import { cn } from "../lib/utils";
import { api, useQuery } from "./api";
import {
  addDays,
  formatTime,
  startOfDay,
  weekdayLabel,
} from "./calendar/dates";
import { planPrompt, queuePrompt } from "./chat/pendingPrompt";
import { describeRemaining, remainingTone } from "./DeadlinesPage";
import { Chip, EmptyNote, PageHeader, Panel, Ring } from "./PageHeader";

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

/** "25 分钟后" / "2 小时 10 分钟后". */
function untilText(target: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.round((target.getTime() - now.getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} 分钟后`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分钟` : ""}后`;
}

/** The prompt behind the assistant panel's button. */
const EVENING_PROMPT =
  "看看我今天剩下的时间和还没完成的作业，帮我把今晚的空档安排成学习块，避开已有的课程和日程。";

function formatDay(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekdayLabel(date)}`;
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
  const progress = useQuery<Progress>("/api/progress");
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
    progress.reload();
  };

  const title = (item: Item) =>
    item.kind === "event" ? item.entry.title : item.block.title;

  const meta = (item: Item) =>
    item.kind === "block"
      ? ["学习块", item.block.course, item.block.assignmentTitle]
          .filter(Boolean)
          .join(" · ")
      : [sourceLabel(item.entry.source), item.entry.location]
          .filter(Boolean)
          .join(" · ");
  const location = (item: Item) =>
    item.kind === "event" ? item.entry.location : item.block.course;

  /** The featured item: what is on now, otherwise what comes next. */
  const featured = current ?? next;
  const elapsed = current
    ? (now.getTime() - current.start.getTime()) /
      (current.end.getTime() - current.start.getTime())
    : 0;
  const week = progress.data?.week;

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <PageHeader title="今天" description={formatDay(now)} />

      {error && (
        <p role="alert" className="-mt-2 text-sm text-destructive">
          无法读取数据：{error}
        </p>
      )}

      {loaded && (
        <section className="relative overflow-hidden rounded-3xl bg-secondary px-7 py-6 text-secondary-foreground">
          {featured ? (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="num text-sm font-medium text-primary">
                  {current
                    ? `正在进行 · 到 ${formatTime(current.end)} 结束`
                    : `接下来 · ${untilText(featured.start, now)}`}
                </div>
                <div className="mt-1.5 truncate text-[28px] font-semibold leading-tight tracking-tight text-foreground">
                  {title(featured)}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-foreground/70">
                  <span className="num inline-flex items-center gap-1.5">
                    <Clock className="size-4 opacity-70" />
                    {formatTime(featured.start)}–{formatTime(featured.end)}
                  </span>
                  {location(featured) && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4 opacity-70" />
                      {location(featured)}
                    </span>
                  )}
                  {current && next && (
                    <span className="num">
                      之后是 {formatTime(next.start)} 的{title(next)}
                    </span>
                  )}
                </div>
              </div>
              <Button variant="accent" asChild>
                <a href="#/calendar">
                  <CalendarDays />
                  在日程中查看
                </a>
              </Button>
            </div>
          ) : (
            <div className="text-[17px] font-medium text-foreground/80">
              {items.length === 0
                ? "今天没有安排，可以自由支配。"
                : "今天的安排都结束了。"}
            </div>
          )}
          {current && (
            // How far through the current class or block we are.
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-1 bg-primary/15"
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(1, elapsed) * 100}%` }}
              />
            </div>
          )}
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="今天的安排">
            {allDay.length > 0 && (
              <p className="mb-2 text-sm text-muted-foreground">
                全天：{allDay.map((entry) => entry.title).join("、")}
              </p>
            )}
            {loaded && items.length === 0 ? (
              <EmptyNote>今天没有课程、日程或学习块。</EmptyNote>
            ) : (
              <ol className="relative">
                {/* The timeline's spine, behind the dots. */}
                {items.length > 1 && (
                  <span
                    aria-hidden
                    className="absolute bottom-7 left-[19px] top-7 w-px bg-border"
                  />
                )}
                {items.map((item) => {
                  const past = item.end <= now;
                  const done = item.kind === "block" && item.block.done;
                  const isCurrent = item === current;
                  // The item the banner above is about stands out here too.
                  const isFeatured = item === featured;
                  return (
                    <li
                      key={
                        item.kind === "event"
                          ? `e${item.entry.id}-${item.entry.start}`
                          : `b${item.block.id}`
                      }
                      className={cn(
                        "relative flex items-center gap-3 rounded-xl px-3 py-2.5",
                        isFeatured && "bg-secondary",
                        past && !done && !isCurrent && "opacity-55",
                      )}
                    >
                      <span className="relative z-10 grid size-4 shrink-0 place-items-center">
                        {item.kind === "block" ? (
                          <input
                            type="checkbox"
                            aria-label={`${item.block.title} 已完成`}
                            checked={item.block.done}
                            onChange={() => void toggleBlock(item.block)}
                            className="size-4"
                          />
                        ) : (
                          <span
                            className={cn(
                              "size-2.5 rounded-full border-2",
                              isFeatured
                                ? "border-primary bg-primary"
                                : "border-muted-foreground/50 bg-card",
                            )}
                          />
                        )}
                      </span>
                      <span
                        className={cn(
                          "num w-[6.5rem] shrink-0 text-sm",
                          isFeatured
                            ? "font-semibold text-primary"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatTime(item.start)}–{formatTime(item.end)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "truncate text-[14px] font-medium",
                            done && "text-muted-foreground line-through",
                          )}
                        >
                          {title(item)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {meta(item)}
                        </div>
                      </div>
                      {isCurrent && <Chip tone="jade">进行中</Chip>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          <Panel title="48 小时内到期">
            {assignments.data && dueSoon.length === 0 ? (
              <EmptyNote>48 小时内没有到期的作业。</EmptyNote>
            ) : (
              <ul className="-mx-1 divide-y">
                {dueSoon.map((item) => {
                  const remaining = describeRemaining(item.dueAt!, now);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 px-1 py-3"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                        <FileText className="size-5" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">
                          {item.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {item.course ?? "未归类"}
                        </div>
                      </div>
                      <Chip tone={remainingTone(item.dueAt!, now)}>
                        {remaining.text}
                      </Chip>
                      <Button
                        variant="accent"
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
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel
            title="本周学习"
            action={
              <a
                href="#/progress"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                查看进度
              </a>
            }
          >
            <div className="flex flex-col items-center gap-3 pb-1 pt-1">
              <Ring
                done={week?.blocksDone ?? 0}
                total={week?.blocks ?? 0}
                label="本周学习块"
              >
                <div className="num text-[34px] font-semibold leading-none tracking-tight">
                  {week ? `${week.blocksDone}/${week.blocks}` : "–"}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  学习块已完成
                </div>
              </Ring>
              {week && week.blocks === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  本周还没有安排学习块。
                </p>
              )}
            </div>
          </Panel>

          {exams.length > 0 && (
            <Panel
              title={`${EXAM_LOOKAHEAD_DAYS} 天内的考试`}
              icon={<GraduationCap className="size-4 text-exam" />}
            >
              <ul className="flex flex-col gap-3">
                {exams.map((exam) => {
                  const start = new Date(exam.start);
                  const days = Math.round(
                    (startOfDay(start).getTime() - dayStart.getTime()) /
                      (24 * HOUR_MS),
                  );
                  return (
                    <li
                      key={`${exam.id}-${exam.start}`}
                      className="flex items-start gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">
                          {exam.title}
                        </div>
                        <div className="num truncate text-xs text-muted-foreground">
                          {[
                            `${start.getMonth() + 1}/${start.getDate()} ${formatTime(start)}`,
                            exam.location,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <Chip tone={days <= 3 ? "danger" : "warn"}>
                        {days === 0
                          ? "今天"
                          : days === 1
                            ? "明天"
                            : `${days} 天后`}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <Panel
            title="让助手安排"
            icon={<Sparkles className="size-4 text-primary" />}
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              助手会看你今天剩下的课程和没完成的作业，把今晚的空档排成学习块，等你确认后再写进日程。
            </p>
            <Button
              className="mt-4 w-full"
              onClick={() => queuePrompt(EVENING_PROMPT)}
            >
              帮我安排今晚
            </Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
