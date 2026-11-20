/** 日程: a day or three-day time grid with classes, events and study blocks. */
import { useQuery } from "@studypal/client/api";
import {
  addDays,
  formatTime,
  isSameDay,
  startOfDay,
  weekdayLabel,
} from "@studypal/client/calendar/dates";
import { placeDay } from "@studypal/client/calendar/layout";
import type { CalendarEntry } from "@studypal/core/calendar/store";
import type { StudyBlock } from "@studypal/core/routes/study";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { editBlock, editEvent } from "@/lib/editing";
import { useReloadOnFocus } from "@/lib/useReloadOnFocus";
import { Button, ErrorNote, Segments, TAB_BAR_SPACE } from "@/ui/parts";
import { radius, space, useColors, type Colors } from "@/ui/theme";

const HOUR_HEIGHT = 56;
const GUTTER = 44;
/** The grid opens scrolled to this hour. */
const FIRST_VISIBLE_HOUR = 7;
const BLOCK_SOURCE = "study-block";

type Span = "1" | "3";

function blockEntry(block: StudyBlock): CalendarEntry {
  return {
    // Negative ids keep block entries from colliding with event ids.
    id: -block.id,
    source: BLOCK_SOURCE,
    title: block.title,
    location: null,
    notes: null,
    start: block.start,
    end: block.end,
    allDay: false,
    series: { startsAt: block.start, endsAt: block.end, rrule: null },
  };
}

function entryColors(source: string, colors: Colors): [string, string] {
  if (source === BLOCK_SOURCE) return [colors.study, colors.studySoft];
  if (source === "exam") return [colors.exam, colors.examSoft];
  if (source === "manual") return [colors.activity, colors.activitySoft];
  return [colors.course, colors.courseSoft];
}

export default function CalendarScreen() {
  const colors = useColors();
  const [span, setSpan] = useState<Span>("1");
  const [first, setFirst] = useState(() => startOfDay(new Date()));
  const [gridWidth, setGridWidth] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const today = new Date();

  const count = Number(span);
  const days = useMemo(
    () => Array.from({ length: count }, (_, index) => addDays(first, index)),
    [first, count],
  );
  const range = `from=${encodeURIComponent(first.toISOString())}&to=${encodeURIComponent(addDays(first, count).toISOString())}`;
  const events = useQuery<CalendarEntry[]>(`/api/events?${range}`);
  const blocks = useQuery<StudyBlock[]>(`/api/study-blocks?${range}`);
  useReloadOnFocus(events.reload, blocks.reload);

  const blocksById = useMemo(
    () => new Map((blocks.data ?? []).map((block) => [block.id, block])),
    [blocks.data],
  );
  const entries = useMemo(
    () => [...(events.data ?? []), ...(blocks.data ?? []).map(blockEntry)],
    [events.data, blocks.data],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      y: FIRST_VISIBLE_HOUR * HOUR_HEIGHT,
      animated: false,
    });
  }, []);

  const open = (entry: CalendarEntry) => {
    if (entry.source === BLOCK_SOURCE) {
      const block = blocksById.get(-entry.id);
      if (!block) return;
      editBlock(block);
      router.push("/block-editor");
    } else {
      editEvent({ kind: "edit", entry });
      router.push("/event-editor");
    }
  };
  const newAt = (day: Date, hour: number) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    editEvent({ kind: "new", start });
    router.push("/event-editor");
  };

  const columnWidth = gridWidth > 0 ? (gridWidth - GUTTER) / count : 0;
  const allDay = entries.filter((entry) => entry.allDay);
  const error = events.error ?? blocks.error;
  const title =
    count === 1
      ? `${first.getMonth() + 1} 月 ${first.getDate()} 日 ${weekdayLabel(first)}`
      : `${first.getMonth() + 1}/${first.getDate()} – ${days[2]!.getMonth() + 1}/${days[2]!.getDate()}`;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[styles.title, { color: colors.foreground }]}>日程</Text>
          <View style={{ flex: 1 }} />
          <Button
            title="添加"
            size="sm"
            onPress={() => {
              const sameDay = isSameDay(first, today);
              newAt(first, sameDay ? Math.min(today.getHours() + 1, 23) : 9);
            }}
          />
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Button
            title="‹"
            size="sm"
            variant="plain"
            onPress={() => setFirst(addDays(first, -count))}
          />
          <Pressable
            onPress={() => setFirst(startOfDay(new Date()))}
            style={{ flex: 1 }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                textAlign: "center",
                color: colors.foreground,
              }}
            >
              {title}
            </Text>
          </Pressable>
          <Button
            title="›"
            size="sm"
            variant="plain"
            onPress={() => setFirst(addDays(first, count))}
          />
        </View>
        <Segments
          value={span}
          options={[
            { value: "1", label: "日" },
            { value: "3", label: "三日" },
          ]}
          onChange={setSpan}
        />
        {error ? <ErrorNote>无法读取日程：{error}</ErrorNote> : null}
      </View>

      {count > 1 ? (
        <View style={[styles.dayRow, { borderColor: colors.border }]}>
          <View style={{ width: GUTTER }} />
          {days.map((day) => {
            const isToday = isSameDay(day, today);
            return (
              <Text
                key={day.getTime()}
                style={{
                  flex: 1,
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: isToday ? "700" : "400",
                  color: isToday ? colors.primary : colors.mutedForeground,
                }}
              >
                {weekdayLabel(day)} {day.getDate()}
              </Text>
            );
          })}
        </View>
      ) : null}

      {allDay.length > 0 ? (
        <View style={[styles.allDay, { borderColor: colors.border }]}>
          {allDay.map((entry) => {
            const [edge, fill] = entryColors(entry.source, colors);
            return (
              <Pressable
                key={`${entry.id}-${entry.start}`}
                onPress={() => open(entry)}
                style={[
                  styles.allDayItem,
                  { backgroundColor: fill, borderLeftColor: edge },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 13, color: colors.foreground }}
                >
                  {entry.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}
        onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
      >
        <View style={{ height: 24 * HOUR_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <View
              key={hour}
              style={[
                styles.hour,
                { top: hour * HOUR_HEIGHT, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.hourLabel, { color: colors.mutedForeground }]}
              >
                {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
              </Text>
              {days.map((day) => (
                <Pressable
                  key={day.getTime()}
                  accessibilityLabel={`在 ${weekdayLabel(day)} ${hour} 点添加日程`}
                  style={{ flex: 1, height: HOUR_HEIGHT }}
                  onPress={() => newAt(day, hour)}
                />
              ))}
            </View>
          ))}

          {days.map((day, dayIndex) =>
            placeDay(entries, day).map((placed) => {
              const [edge, fill] = entryColors(placed.entry.source, colors);
              const width = columnWidth / placed.columns;
              const top = (placed.startMinute / 60) * HOUR_HEIGHT;
              const height = Math.max(
                22,
                ((placed.endMinute - placed.startMinute) / 60) * HOUR_HEIGHT -
                  2,
              );
              const block =
                placed.entry.source === BLOCK_SOURCE
                  ? blocksById.get(-placed.entry.id)
                  : undefined;
              return (
                <Pressable
                  key={`${placed.entry.id}-${placed.entry.start}-${dayIndex}`}
                  onPress={() => open(placed.entry)}
                  style={[
                    styles.entry,
                    {
                      top,
                      height,
                      left:
                        GUTTER +
                        dayIndex * columnWidth +
                        placed.column * width +
                        1,
                      width: width - 2,
                      backgroundColor: fill,
                      borderLeftColor: edge,
                      opacity: block?.done ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={height > 40 ? 2 : 1}
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: colors.foreground,
                      textDecorationLine: block?.done ? "line-through" : "none",
                    }}
                  >
                    {placed.entry.title}
                  </Text>
                  {height > 40 ? (
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 11, color: colors.mutedForeground }}
                    >
                      {formatTime(new Date(placed.entry.start))}
                      {placed.entry.location
                        ? ` · ${placed.entry.location}`
                        : ""}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }),
          )}

          {days.map((day, dayIndex) =>
            isSameDay(day, today) ? (
              <View
                key="now"
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: GUTTER + dayIndex * columnWidth,
                  width: columnWidth,
                  top:
                    ((today.getHours() * 60 + today.getMinutes()) / 60) *
                    HOUR_HEIGHT,
                  height: 2,
                  backgroundColor: colors.destructive,
                }}
              />
            ) : null,
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  title: { fontSize: 32, fontWeight: "700", letterSpacing: -0.5 },
  dayRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  allDay: {
    paddingHorizontal: space.lg,
    paddingVertical: 6,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  allDayItem: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hour: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hourLabel: {
    width: GUTTER,
    fontSize: 10,
    textAlign: "center",
    marginTop: -7,
  },
  entry: {
    position: "absolute",
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 3,
    overflow: "hidden",
  },
});
