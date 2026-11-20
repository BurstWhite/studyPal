/** Sheet for adding an assignment by hand. */
import { api } from "@studypal/client/api";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { message } from "@/lib/useReloadOnFocus";
import { Button, ErrorNote, TextField } from "@/ui/parts";
import { space, useColors } from "@/ui/theme";

/** Tomorrow at 23:59, a typical deadline. */
function defaultDue(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(23, 59, 0, 0);
  return date;
}

export default function NewAssignmentSheet() {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [hasDue, setHasDue] = useState(true);
  const [due, setDue] = useState(defaultDue);
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setProblem(undefined);
    if (!title.trim()) {
      setProblem("请填写标题");
      return;
    }
    setSaving(true);
    try {
      await api("/api/assignments", {
        method: "POST",
        body: JSON.stringify({
          title,
          course,
          dueAt: hasDue ? due.toISOString() : null,
        }),
      });
      router.back();
    } catch (reason) {
      setProblem(message(reason));
      setSaving(false);
    }
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
        添加作业
      </Text>
      <TextField
        label="标题"
        placeholder="作业标题"
        autoFocus
        value={title}
        onChangeText={setTitle}
      />
      <TextField
        label="课程"
        placeholder="可不填"
        value={course}
        onChangeText={setCourse}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 16, color: colors.foreground }}>截止时间</Text>
        <Switch
          value={hasDue}
          onValueChange={setHasDue}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {hasDue ? (
        <DateTimePicker
          value={due}
          mode="datetime"
          display="inline"
          locale="zh-CN"
          accentColor={colors.primary}
          onChange={(_event, value) => value && setDue(value)}
        />
      ) : null}
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
      <Button title="添加" onPress={() => void save()} busy={saving} />
    </ScrollView>
  );
}
