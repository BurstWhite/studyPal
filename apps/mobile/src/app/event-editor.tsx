/** Sheet for adding, editing or viewing an event. */
import { api } from "@studypal/client/api";
import { addDays, startOfDay } from "@studypal/client/calendar/dates";
import {
  eventRequestBody,
  readRepeat,
  REPEAT_LABELS,
  type Repeat,
} from "@studypal/client/calendar/eventForm";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Switch, Text, View } from "react-native";
import { eventToEdit } from "@/lib/editing";
import { message } from "@/lib/useReloadOnFocus";
import { Button, ErrorNote, Segments, TextField } from "@/ui/parts";
import { space, useColors } from "@/ui/theme";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
      }}
    >
      <Text style={{ fontSize: 16, color: colors.foreground }}>{label}</Text>
      {children}
    </View>
  );
}

export default function EventEditorSheet() {
  const colors = useColors();
  const [target] = useState(
    () => eventToEdit() ?? { kind: "new" as const, start: new Date() },
  );
  const existing = target.kind === "edit" ? target.entry : undefined;
  const readOnly = existing !== undefined && existing.source !== "manual";

  const [title, setTitle] = useState(existing?.title ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(() =>
    existing
      ? new Date(existing.series.startsAt)
      : target.kind === "new"
        ? target.start
        : new Date(),
  );
  const [end, setEnd] = useState(() => {
    if (!existing) return new Date(start.getTime() + 60 * 60_000);
    const stored = new Date(existing.series.endsAt);
    // All-day events are stored with an exclusive end; show the last day.
    return existing.allDay ? addDays(stored, -1) : stored;
  });
  const initialRepeat = readRepeat(existing?.series.rrule ?? null);
  const [repeat, setRepeat] = useState<Repeat>(initialRepeat.repeat);
  const [lastDay, setLastDay] = useState<Date | null>(
    initialRepeat.until ? startOfDay(initialRepeat.until) : null,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
      router.back();
    } catch (reason) {
      setProblem(message(reason));
      setBusy(false);
    }
  };

  const save = () => {
    const request = eventRequestBody({
      title,
      location,
      notes,
      allDay,
      start: allDay ? startOfDay(start) : start,
      end: allDay ? startOfDay(end) : end,
      repeat,
      lastDay: repeat === "none" ? null : lastDay,
    });
    if ("problem" in request) {
      setProblem(request.problem);
      return;
    }
    void run(() =>
      existing
        ? api(`/api/events/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(request.body),
          })
        : api("/api/events", {
            method: "POST",
            body: JSON.stringify(request.body),
          }),
    );
  };

  const remove = () =>
    Alert.alert(
      "删除这条日程？",
      existing?.series.rrule ? "这是重复日程，会删除整个系列。" : undefined,
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () =>
            void run(() =>
              api(`/api/events/${existing!.id}`, { method: "DELETE" }),
            ),
        },
      ],
    );

  const pickerMode = allDay ? "date" : "datetime";
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
    >
      <Text
        style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}
      >
        {existing ? (readOnly ? "日程详情" : "编辑日程") : "添加日程"}
      </Text>
      {readOnly ? (
        <Text style={{ color: colors.mutedForeground }}>
          这条日程是同步来的，不能在这里修改。
        </Text>
      ) : existing?.series.rrule ? (
        <Text style={{ color: colors.mutedForeground }}>
          这是重复日程，修改或删除会应用到整个系列。
        </Text>
      ) : null}
      <TextField
        label="标题"
        value={title}
        onChangeText={setTitle}
        editable={!readOnly}
        autoFocus={!existing}
      />
      <TextField
        label="地点"
        value={location}
        onChangeText={setLocation}
        editable={!readOnly}
      />
      <Row label="全天">
        <Switch
          value={allDay}
          onValueChange={setAllDay}
          disabled={readOnly}
          trackColor={{ true: colors.primary }}
        />
      </Row>
      <Row label={allDay ? "第一天" : "开始"}>
        <DateTimePicker
          value={start}
          mode={pickerMode}
          locale="zh-CN"
          disabled={readOnly}
          accentColor={colors.primary}
          onChange={(_event, value) => {
            if (!value) return;
            // Keep the length when moving the start.
            setEnd(
              new Date(end.getTime() + (value.getTime() - start.getTime())),
            );
            setStart(value);
          }}
        />
      </Row>
      <Row label={allDay ? "最后一天" : "结束"}>
        <DateTimePicker
          value={end}
          mode={pickerMode}
          locale="zh-CN"
          disabled={readOnly}
          accentColor={colors.primary}
          onChange={(_event, value) => value && setEnd(value)}
        />
      </Row>
      {!readOnly ? (
        <View style={{ gap: space.sm }}>
          <Text style={{ fontSize: 16, color: colors.foreground }}>重复</Text>
          <Segments
            value={repeat}
            options={(Object.keys(REPEAT_LABELS) as Repeat[]).map((value) => ({
              value,
              label: REPEAT_LABELS[value],
            }))}
            onChange={setRepeat}
          />
          {repeat !== "none" ? (
            <Row label="重复到">
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                {lastDay ? (
                  <DateTimePicker
                    value={lastDay}
                    mode="date"
                    locale="zh-CN"
                    accentColor={colors.primary}
                    onChange={(_event, value) =>
                      value && setLastDay(startOfDay(value))
                    }
                  />
                ) : null}
                <Button
                  title={lastDay ? "不设结束" : "设置结束日期"}
                  size="sm"
                  variant="plain"
                  onPress={() =>
                    setLastDay(
                      lastDay ? null : addDays(startOfDay(start), 7 * 16),
                    )
                  }
                />
              </View>
            </Row>
          ) : null}
        </View>
      ) : null}
      <TextField
        label="备注"
        value={notes}
        onChangeText={setNotes}
        editable={!readOnly}
        multiline
        style={{ minHeight: 80, paddingTop: 10 }}
      />
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
      {readOnly ? (
        <Button title="关闭" variant="accent" onPress={() => router.back()} />
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {existing ? (
            <Button
              title="删除"
              variant="danger"
              disabled={busy}
              onPress={remove}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button title="保存" busy={busy} onPress={save} style={{ flex: 1 }} />
        </View>
      )}
    </ScrollView>
  );
}
