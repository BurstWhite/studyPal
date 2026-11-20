/** 今天: what is on now, today's timeline, deadlines and exams coming up. */
import { api, useQuery } from "@studypal/client/api";
import { describeRemaining, remainingTone } from "@studypal/client/assignments";
import {
  addDays,
  formatTime,
  startOfDay,
  weekdayLabel,
} from "@studypal/client/calendar/dates";
import { planPrompt, queuePrompt } from "@studypal/client/chat/pendingPrompt";
import type { CalendarEntry } from "@studypal/core/calendar/store";
import type { Assignment } from "@studypal/core/routes/assignments";
import type { Progress, StudyBlock } from "@studypal/core/routes/study";
import { router } from "expo-router";
import { useReloadOnFocus } from "@/lib/useReloadOnFocus";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Chip,
  EmptyNote,
  ErrorNote,
  Meter,
  Panel,
  Screen,
} from "@/ui/parts";
import { radius, space, useColors } from "@/ui/theme";

const HOUR_MS = 3_600_000;
/** Assignments due within this long are listed. */
const DUE_SOON_MS = 48 * HOUR_MS;
/** Exams this far ahead are listed. */
const EXAM_LOOKAHEAD_DAYS = 14;

/** The prompt behind the assistant panel's button. */
const EVENING_PROMPT =
  "看看我今天剩下的时间和还没完成的作业，帮我把今晚的空档安排成学习块，避开已有的课程和日程。";

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

function formatDay(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekdayLabel(date)}`;
}

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

export default function TodayScreen() {
  const colors = useColors();
  // Re-render each minute so "now" and the countdowns stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dayKey = now.toDateString();
  const dayStart = useMemo(() => startOfDay(now), [dayKey]);
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
  useReloadOnFocus(
    today.reload,
    ahead.reload,
    blocks.reload,
    assignments.reload,
    progress.reload,
  );
  const [problem, setProblem] = useState<string>();

  const reloadAll = () => {
    setNow(new Date());
    today.reload();
    ahead.reload();
    blocks.reload();
    assignments.reload();
    progress.reload();
  };

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
  const featured = current ?? next;
  const elapsed = current
    ? (now.getTime() - current.start.getTime()) /
      (current.end.getTime() - current.start.getTime())
    : 0;

  const dueSoon = (assignments.data ?? []).filter(
    (item) =>
      item.status === "open" &&
      item.dueAt !== null &&
      new Date(item.dueAt).getTime() - now.getTime() <= DUE_SOON_MS,
  );
  const exams = (ahead.data ?? []).filter(
    (entry) => entry.source === "exam" && new Date(entry.end) > now,
  );
  const week = progress.data?.week;

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

  return (
    <Screen
      title="今天"
      subtitle={formatDay(now)}
      onRefresh={reloadAll}
      refreshing={false}
    >
      {error ? <ErrorNote>无法读取数据：{error}</ErrorNote> : null}

      {loaded ? (
        <View style={[styles.featured, { backgroundColor: colors.secondary }]}>
          {featured ? (
            <>
              <Text style={[styles.featuredLead, { color: colors.primary }]}>
                {current
                  ? `正在进行 · 到 ${formatTime(current.end)} 结束`
                  : `接下来 · ${untilText(featured.start, now)}`}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.featuredTitle, { color: colors.foreground }]}
              >
                {title(featured)}
              </Text>
              <Text
                style={[styles.featuredMeta, { color: colors.mutedForeground }]}
              >
                {[
                  `${formatTime(featured.start)}–${formatTime(featured.end)}`,
                  featured.kind === "event"
                    ? featured.entry.location
                    : featured.block.course,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {current && next ? (
                <Text
                  style={[
                    styles.featuredMeta,
                    { color: colors.mutedForeground },
                  ]}
                >
                  之后是 {formatTime(next.start)} 的{title(next)}
                </Text>
              ) : null}
              {current ? (
                <View
                  style={[styles.elapsed, { backgroundColor: colors.border }]}
                >
                  <View
                    style={{
                      width: `${Math.min(1, elapsed) * 100}%`,
                      height: "100%",
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
              ) : null}
            </>
          ) : (
            <Text style={[styles.featuredIdle, { color: colors.foreground }]}>
              {items.length === 0
                ? "今天没有安排，可以自由支配。"
                : "今天的安排都结束了。"}
            </Text>
          )}
        </View>
      ) : null}

      <Panel
        title="今天的安排"
        action={
          <Button
            title="日程"
            variant="plain"
            size="sm"
            onPress={() => router.navigate("/calendar")}
          />
        }
      >
        {allDay.length > 0 ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
            全天：{allDay.map((entry) => entry.title).join("、")}
          </Text>
        ) : null}
        {loaded && items.length === 0 ? (
          <EmptyNote>今天没有课程、日程或学习块。</EmptyNote>
        ) : (
          items.map((item) => {
            const past = item.end <= now;
            const done = item.kind === "block" && item.block.done;
            const isFeatured = item === featured;
            return (
              <Pressable
                key={
                  item.kind === "event"
                    ? `e${item.entry.id}-${item.entry.start}`
                    : `b${item.block.id}`
                }
                disabled={item.kind !== "block"}
                onPress={() =>
                  item.kind === "block" && void toggleBlock(item.block)
                }
                accessibilityRole={
                  item.kind === "block" ? "checkbox" : undefined
                }
                accessibilityState={
                  item.kind === "block"
                    ? { checked: item.block.done }
                    : undefined
                }
                style={[
                  styles.row,
                  isFeatured && { backgroundColor: colors.secondary },
                  past && !done && item !== current && { opacity: 0.55 },
                ]}
              >
                {item.kind === "block" ? (
                  <View
                    style={[
                      styles.check,
                      {
                        borderColor: colors.primary,
                        backgroundColor: done ? colors.primary : "transparent",
                      },
                    ]}
                  >
                    {done ? (
                      <Text
                        style={{
                          color: colors.primaryForeground,
                          fontSize: 12,
                        }}
                      >
                        ✓
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <View
                    style={[
                      styles.dot,
                      {
                        borderColor: isFeatured
                          ? colors.primary
                          : colors.mutedForeground,
                        backgroundColor: isFeatured
                          ? colors.primary
                          : colors.card,
                      },
                    ]}
                  />
                )}
                <Text
                  style={[
                    styles.time,
                    {
                      color: isFeatured
                        ? colors.primary
                        : colors.mutedForeground,
                      fontWeight: isFeatured ? "600" : "400",
                    },
                  ]}
                >
                  {formatTime(item.start)}–{formatTime(item.end)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.rowTitle,
                      {
                        color: done
                          ? colors.mutedForeground
                          : colors.foreground,
                        textDecorationLine: done ? "line-through" : "none",
                      },
                    ]}
                  >
                    {title(item)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowMeta, { color: colors.mutedForeground }]}
                  >
                    {meta(item)}
                  </Text>
                </View>
                {item === current ? <Chip tone="jade">进行中</Chip> : null}
              </Pressable>
            );
          })
        )}
      </Panel>

      <Panel title="48 小时内到期">
        {assignments.data && dueSoon.length === 0 ? (
          <EmptyNote>48 小时内没有到期的作业。</EmptyNote>
        ) : (
          dueSoon.map((item) => (
            <View key={item.id} style={styles.dueRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  numberOfLines={1}
                  style={[styles.rowTitle, { color: colors.foreground }]}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.rowMeta, { color: colors.mutedForeground }]}
                >
                  {item.course ?? "未归类"}
                </Text>
                <Chip tone={remainingTone(item.dueAt!, now)}>
                  {describeRemaining(item.dueAt!, now).text}
                </Chip>
              </View>
              <Button
                title="生成计划"
                variant="accent"
                size="sm"
                onPress={() => queuePrompt(planPrompt(item))}
              />
            </View>
          ))
        )}
      </Panel>

      <Panel
        title="本周学习"
        action={
          <Button
            title="查看进度"
            variant="plain"
            size="sm"
            onPress={() => router.navigate("/me")}
          />
        }
      >
        <Text style={[styles.weekNumber, { color: colors.foreground }]}>
          {week ? `${week.blocksDone}/${week.blocks}` : "–"}
          <Text style={{ fontSize: 14, color: colors.mutedForeground }}>
            {"  学习块已完成"}
          </Text>
        </Text>
        <Meter done={week?.blocksDone ?? 0} total={week?.blocks ?? 0} />
        {week && week.blocks === 0 ? (
          <EmptyNote>本周还没有安排学习块。</EmptyNote>
        ) : null}
      </Panel>

      {exams.length > 0 ? (
        <Panel title={`${EXAM_LOOKAHEAD_DAYS} 天内的考试`}>
          {exams.map((exam) => {
            const start = new Date(exam.start);
            const days = Math.round(
              (startOfDay(start).getTime() - dayStart.getTime()) /
                (24 * HOUR_MS),
            );
            return (
              <View key={`${exam.id}-${exam.start}`} style={styles.dueRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowTitle, { color: colors.foreground }]}
                  >
                    {exam.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.rowMeta, { color: colors.mutedForeground }]}
                  >
                    {[
                      `${start.getMonth() + 1}/${start.getDate()} ${formatTime(start)}`,
                      exam.location,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Chip tone={days <= 3 ? "danger" : "warn"}>
                  {days === 0 ? "今天" : days === 1 ? "明天" : `${days} 天后`}
                </Chip>
              </View>
            );
          })}
        </Panel>
      ) : null}

      <Panel title="让助手安排">
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          助手会看你今天剩下的课程和没完成的作业，把今晚的空档排成学习块，等你确认后再写进日程。
        </Text>
        <Button
          title="帮我安排今晚"
          onPress={() => queuePrompt(EVENING_PROMPT)}
          style={{ marginTop: space.sm }}
        />
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  featured: {
    borderRadius: radius.xl,
    padding: space.xl,
    gap: 6,
    overflow: "hidden",
  },
  featuredLead: { fontSize: 14, fontWeight: "600" },
  featuredTitle: { fontSize: 26, fontWeight: "700", letterSpacing: -0.3 },
  featuredMeta: { fontSize: 14 },
  featuredIdle: { fontSize: 17, fontWeight: "500" },
  elapsed: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    marginHorizontal: 4,
  },
  time: { width: 92, fontSize: 13, fontVariant: ["tabular-nums"] },
  rowTitle: { fontSize: 15, fontWeight: "500" },
  rowMeta: { fontSize: 12 },
  dueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
  },
  weekNumber: {
    fontSize: 30,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
