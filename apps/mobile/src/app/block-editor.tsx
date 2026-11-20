/** Sheet for a study block: mark it done, move it, rename it or delete it. */
import { api } from "@studypal/client/api";
import { toLocalIso } from "@studypal/client/calendar/dates";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { blockToEdit } from "@/lib/editing";
import { message } from "@/lib/useReloadOnFocus";
import { Button, ErrorNote, TextField } from "@/ui/parts";
import { space, useColors } from "@/ui/theme";

export default function BlockEditorSheet() {
  const colors = useColors();
  const [block] = useState(blockToEdit);
  const [title, setTitle] = useState(block?.title ?? "");
  const [start, setStart] = useState(
    () => new Date(block?.start ?? Date.now()),
  );
  const [end, setEnd] = useState(() => new Date(block?.end ?? Date.now()));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  if (!block) return null;

  const run = async (init: RequestInit) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api(`/api/study-blocks/${block.id}`, init);
      router.back();
    } catch (reason) {
      setProblem(message(reason));
      setBusy(false);
    }
  };

  const save = () => {
    if (!title.trim()) return setProblem("请填写标题");
    if (end <= start) return setProblem("结束时间必须晚于开始时间");
    void run({
      method: "PATCH",
      body: JSON.stringify({
        title,
        startsAt: toLocalIso(start),
        endsAt: toLocalIso(end),
      }),
    });
  };

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
        学习块
      </Text>
      {block.assignmentTitle ? (
        <Text style={{ color: colors.mutedForeground }}>
          {[block.course, block.assignmentTitle].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
      <Button
        title={block.done ? "标为未完成" : "标为已完成"}
        variant="accent"
        disabled={busy}
        onPress={() =>
          void run({
            method: "PATCH",
            body: JSON.stringify({ done: !block.done }),
          })
        }
      />
      <TextField label="标题" value={title} onChangeText={setTitle} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 16, color: colors.foreground }}>开始</Text>
        <DateTimePicker
          value={start}
          mode="datetime"
          locale="zh-CN"
          accentColor={colors.primary}
          onChange={(_event, value) => {
            if (!value) return;
            setEnd(
              new Date(end.getTime() + (value.getTime() - start.getTime())),
            );
            setStart(value);
          }}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 16, color: colors.foreground }}>结束</Text>
        <DateTimePicker
          value={end}
          mode="datetime"
          locale="zh-CN"
          accentColor={colors.primary}
          onChange={(_event, value) => value && setEnd(value)}
        />
      </View>
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          title="删除"
          variant="danger"
          disabled={busy}
          style={{ flex: 1 }}
          onPress={() =>
            Alert.alert("删除这个学习块？", undefined, [
              { text: "取消", style: "cancel" },
              {
                text: "删除",
                style: "destructive",
                onPress: () => void run({ method: "DELETE" }),
              },
            ])
          }
        />
        <Button title="保存" busy={busy} onPress={save} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}
