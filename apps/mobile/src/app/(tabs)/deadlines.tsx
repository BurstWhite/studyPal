/** 作业: assignments by how soon they are due, with search and filters. */
import { api, useQuery } from "@studypal/client/api";
import {
  assignmentLists,
  describeRemaining,
  formatDue,
  matchesQuery,
  remainingTone,
} from "@studypal/client/assignments";
import { planPrompt, queuePrompt } from "@studypal/client/chat/pendingPrompt";
import type {
  Assignment,
  AssignmentStatus,
} from "@studypal/core/routes/assignments";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { message, useReloadOnFocus } from "@/lib/useReloadOnFocus";
import {
  Button,
  Check,
  Chip,
  EmptyNote,
  ErrorNote,
  Panel,
  Screen,
  Segments,
  TextField,
} from "@/ui/parts";
import { radius, space, useColors } from "@/ui/theme";

type Filter = "open" | "week" | "done" | "dismissed";

function Row({
  item,
  onStatus,
  onDelete,
}: {
  item: Assignment;
  onStatus: (status: AssignmentStatus) => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [problem, setProblem] = useState<string>();
  const open = item.status === "open";
  const now = new Date();
  const remaining =
    item.dueAt && open ? describeRemaining(item.dueAt, now) : undefined;

  const openOnPlatform = () => {
    setProblem(undefined);
    api("/api/open-external", {
      method: "POST",
      body: JSON.stringify({ url: item.url }),
    }).catch((reason: unknown) => setProblem(message(reason)));
  };

  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.rowMain}>
        <Pressable
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityLabel={`${item.title} 已完成`}
          accessibilityState={{ checked: item.status === "done" }}
          onPress={() => onStatus(item.status === "done" ? "open" : "done")}
        >
          <Check checked={item.status === "done"} />
        </Pressable>
        <Pressable
          style={{ flex: 1, gap: 3 }}
          onPress={() => setExpanded(!expanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
        >
          <Text
            numberOfLines={expanded ? undefined : 2}
            style={[
              styles.title,
              {
                color: open ? colors.foreground : colors.mutedForeground,
                textDecorationLine: open ? "none" : "line-through",
              },
            ]}
          >
            {item.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.meta, { color: colors.mutedForeground }]}
          >
            {[
              item.course,
              item.dueAt ? `${formatDue(item.dueAt)} 截止` : "没有截止时间",
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {remaining ? (
              <Chip tone={remainingTone(item.dueAt!, now)}>
                {remaining.text}
              </Chip>
            ) : null}
            {item.status === "dismissed" ? <Chip>已忽略</Chip> : null}
          </View>
        </Pressable>
      </View>

      {expanded ? (
        <View style={[styles.details, { backgroundColor: colors.muted }]}>
          <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>
            {item.description ?? "老师没有写作业说明。"}
          </Text>
          {item.attachments.length > 0 ? (
            <Text style={{ color: colors.mutedForeground }}>
              <Text style={{ color: colors.foreground }}>附件：</Text>
              {item.attachments.join("、")}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {open ? (
              <Button
                title="生成计划"
                variant="accent"
                size="sm"
                onPress={() => queuePrompt(planPrompt(item))}
              />
            ) : null}
            {item.url ? (
              <Button
                title="在学在浙大打开"
                variant="accent"
                size="sm"
                onPress={openOnPlatform}
              />
            ) : null}
            {item.source === "manual" ? (
              <Button
                title="删除"
                variant="danger"
                size="sm"
                onPress={onDelete}
              />
            ) : item.status === "dismissed" ? (
              <Button
                title="恢复"
                variant="plain"
                size="sm"
                onPress={() => onStatus("open")}
              />
            ) : open ? (
              <Button
                title="忽略"
                variant="plain"
                size="sm"
                onPress={() => onStatus("dismissed")}
              />
            ) : null}
          </View>
          {problem ? <ErrorNote>{problem}</ErrorNote> : null}
        </View>
      ) : null}
    </View>
  );
}

export default function DeadlinesScreen() {
  const colors = useColors();
  const { data, error, loading, reload } =
    useQuery<Assignment[]>("/api/assignments");
  useReloadOnFocus(reload);
  const [problem, setProblem] = useState<string>();
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await action();
    } catch (reason) {
      setProblem(message(reason));
    }
    reload();
  };
  const setStatus = (item: Assignment, status: AssignmentStatus) =>
    run(() =>
      api(`/api/assignments/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    );
  const remove = (item: Assignment) =>
    run(() => api(`/api/assignments/${item.id}`, { method: "DELETE" }));

  const lists = assignmentLists(data ?? [], Date.now());
  const filters: { value: Filter; label: string }[] = [
    { value: "open", label: `待完成 ${lists.open.length}` },
    { value: "week", label: `7 天内 ${lists.thisWeek.length}` },
    { value: "done", label: `已完成 ${lists.done.length}` },
    ...(lists.dismissed.length > 0
      ? [
          {
            value: "dismissed" as const,
            label: `已忽略 ${lists.dismissed.length}`,
          },
        ]
      : []),
  ];
  const groups: { title: string; items: Assignment[]; danger?: boolean }[] =
    filter === "open"
      ? [
          { title: "已截止", items: lists.overdue, danger: true },
          { title: "7 天内到期", items: lists.soon },
          { title: "之后", items: lists.later },
          { title: "没有截止时间", items: lists.undated },
        ]
      : [
          {
            title: filters.find((option) => option.value === filter)!.label,
            items:
              filter === "week"
                ? lists.thisWeek
                : filter === "done"
                  ? lists.done
                  : lists.dismissed,
          },
        ];
  const visible = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matchesQuery(item, query)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <Screen
      title="作业"
      subtitle="学在浙大的待办会自动同步"
      action={
        <Button
          title="添加"
          size="sm"
          onPress={() => router.push("/assignment-new")}
        />
      }
      onRefresh={reload}
      refreshing={false}
    >
      <Segments value={filter} options={filters} onChange={setFilter} />
      <TextField
        placeholder="搜索作业或课程"
        value={query}
        onChangeText={setQuery}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {error || problem ? (
        <ErrorNote>{error ? `无法读取作业：${error}` : problem}</ErrorNote>
      ) : null}
      {loading && !data ? <EmptyNote>正在读取…</EmptyNote> : null}
      {data && visible.length === 0 ? (
        <EmptyNote>
          {query.trim()
            ? `没有和「${query.trim()}」匹配的作业。`
            : filter === "open"
              ? "没有待完成的作业。在「我的」里登录浙大账号后会自动同步，也可以点「添加」手动添加。"
              : filter === "week"
                ? "7 天内没有到期的作业。"
                : "这里还是空的。"}
        </EmptyNote>
      ) : null}
      {visible.map((group) => (
        <Panel key={group.title} style={{ paddingVertical: space.sm }}>
          <Text
            style={[
              styles.groupTitle,
              { color: group.danger ? colors.destructive : colors.foreground },
            ]}
          >
            {group.title}（{group.items.length}）
          </Text>
          {group.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onStatus={(status) => void setStatus(item, status)}
              onDelete={() => void remove(item)}
            />
          ))}
        </Panel>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  rowMain: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  title: { fontSize: 16, fontWeight: "500" },
  meta: { fontSize: 13, fontVariant: ["tabular-nums"] },
  groupTitle: { fontSize: 15, fontWeight: "600", paddingTop: space.sm },
  details: {
    marginLeft: 34,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
