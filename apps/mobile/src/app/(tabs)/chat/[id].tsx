/** One conversation: messages, tool calls awaiting approval, and the input box. */
import { api, useQuery } from "@studypal/client/api";
import {
  decide,
  decideAll,
  onTurnFinished,
  sendMessage,
  setProblem,
  showStored,
  takeReturnedDraft,
  useChatView,
  type ChatView,
  type LiveTool,
} from "@studypal/client/chat/liveChats";
import {
  choiceKey,
  currentModel,
  modelOptions,
  sameWireFormat,
  type ModelChoice,
} from "@studypal/client/chat/models";
import { groupPending } from "@studypal/client/chat/batches";
import { summarizeTool } from "@studypal/client/chat/toolSummary";
import { isWaitingForReply } from "@studypal/client/chat/waiting";
import type { ModelList } from "@studypal/core/llm/models";
import type { ChatSummary, Provider } from "@studypal/core/llm/store";
import type { DisplayItem } from "@studypal/core/llm/turn";
import { DECLINED_MESSAGE } from "@studypal/core/shared/chat";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { message } from "@/lib/useReloadOnFocus";
import { Markdown } from "@/ui/Markdown";
import { Button, ErrorNote } from "@/ui/parts";
import { radius, space, useColors } from "@/ui/theme";

const NO_VIEW: ChatView = { items: [], running: false, thinking: false };

function ToolCard({
  item,
  onDecision,
}: {
  item: LiveTool;
  onDecision: (approve: boolean) => void;
}) {
  const colors = useColors();
  const summary = summarizeTool(item.name, item.input);
  const failed = item.result && !item.result.ok;
  // After a reload only the stored result says that the user declined.
  const declined = item.declined || item.result?.content === DECLINED_MESSAGE;
  const state = item.awaiting
    ? "等待你确认"
    : !item.result
      ? undefined
      : declined
        ? "已拒绝"
        : failed
          ? "未成功"
          : "完成";
  return (
    <View
      style={[
        styles.tool,
        {
          borderColor: item.awaiting ? colors.primary : colors.border,
          backgroundColor: item.awaiting ? colors.secondary : colors.card,
        },
      ]}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <Text style={{ flex: 1, fontWeight: "600", color: colors.foreground }}>
          {summary.label}
        </Text>
        {state ? (
          <Text
            style={{
              fontSize: 12,
              color:
                failed && !declined
                  ? colors.destructive
                  : colors.mutedForeground,
            }}
          >
            {state}
          </Text>
        ) : (
          <ActivityIndicator size="small" />
        )}
      </View>
      {summary.lines.map((line, index) => (
        <Text
          key={index}
          style={{ fontSize: 13, color: colors.mutedForeground }}
        >
          {line}
        </Text>
      ))}
      {failed && !declined ? (
        <Text style={{ fontSize: 13, color: colors.destructive }}>
          {item.result!.content}
        </Text>
      ) : null}
      {item.awaiting ? (
        <View
          style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}
        >
          <Button title="确认" size="sm" onPress={() => onDecision(true)} />
          <Button
            title="拒绝"
            size="sm"
            variant="plain"
            onPress={() => onDecision(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

function BatchCard({
  tools,
  onDecision,
}: {
  tools: LiveTool[];
  onDecision: (approve: boolean) => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const label = summarizeTool(tools[0]!.name, tools[0]!.input).label;
  return (
    <View
      style={[
        styles.tool,
        { borderColor: colors.primary, backgroundColor: colors.secondary },
      ]}
    >
      <Pressable
        onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <Text style={{ flex: 1, fontWeight: "600", color: colors.foreground }}>
          {label}（{tools.length} 项）
        </Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
          {open ? "收起" : "展开"}
        </Text>
      </Pressable>
      {open
        ? tools.map((tool) => (
            <Text
              key={tool.id}
              style={{ fontSize: 13, color: colors.mutedForeground }}
            >
              {summarizeTool(tool.name, tool.input).lines.join(" · ") || label}
            </Text>
          ))
        : null}
      <View
        style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}
      >
        <Button title="全部确认" size="sm" onPress={() => onDecision(true)} />
        <Button
          title="全部拒绝"
          size="sm"
          variant="plain"
          onPress={() => onDecision(false)}
        />
      </View>
    </View>
  );
}

function ModelSheet({
  visible,
  providers,
  lists,
  value,
  onChoose,
  onClose,
}: {
  visible: boolean;
  providers: Provider[];
  lists: ModelList[] | undefined;
  value: ModelChoice | undefined;
  onChoose: (choice: ModelChoice) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text
            style={{
              flex: 1,
              fontSize: 22,
              fontWeight: "700",
              color: colors.foreground,
            }}
          >
            选择模型
          </Text>
          <Button title="完成" variant="plain" size="sm" onPress={onClose} />
        </View>
        {!lists ? <ActivityIndicator /> : null}
        {modelOptions(providers, lists, value).map(
          ({ provider, models, error }) => (
            <View key={provider.id} style={{ gap: space.xs }}>
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
                {error ? `${provider.name}（模型列表获取失败）` : provider.name}
              </Text>
              {models.map((model) => {
                const choice = { providerId: provider.id, model };
                const selected =
                  value && choiceKey(value) === choiceKey(choice);
                return (
                  <Pressable
                    key={model}
                    onPress={() => onChoose(choice)}
                    style={[
                      styles.modelRow,
                      {
                        backgroundColor: selected
                          ? colors.secondary
                          : colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={{ flex: 1, color: colors.foreground }}>
                      {model}
                    </Text>
                    {selected ? (
                      <Text style={{ color: colors.primary }}>✓</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ),
        )}
      </ScrollView>
    </Modal>
  );
}

export default function ConversationScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string; initial?: string }>();
  const chatId = Number(params.id);
  const { data, error, reload } = useQuery<{
    chat: ChatSummary;
    items: DisplayItem[];
  }>(`/api/chats/${chatId}`);
  // The first finished turn gives the chat its title.
  useEffect(() => onTurnFinished(reload), [reload]);
  const providers = useQuery<Provider[]>("/api/providers");
  const modelLists = useQuery<ModelList[]>("/api/models");
  const [chat, setChat] = useState<ChatSummary>();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Turns live outside this view, so they carry on after leaving the screen.
  const view = useChatView(chatId) ?? NO_VIEW;
  const { items, running, thinking, problem } = view;

  useEffect(() => {
    if (data) {
      showStored(chatId, data.items);
      setChat(data.chat);
    }
  }, [data, chatId]);

  // A turn that failed gives its message back to the input box.
  useEffect(() => {
    if (view.returnedDraft === undefined) return;
    setDraft(view.returnedDraft);
    takeReturnedDraft(chatId);
  }, [view.returnedDraft, chatId]);

  const send = (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || running) return;
    setDraft("");
    void sendMessage(chatId, text);
  };

  // A prompt handed over from another tab is sent once the chat has loaded.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (data && params.initial && !sentInitial.current) {
      sentInitial.current = true;
      send(params.initial);
    }
    // Runs once, when the conversation first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params.initial]);

  const allProviders = providers.data ?? [];
  const activeModel = chat && currentModel(chat, allProviders);
  const activeChoice: ModelChoice | undefined =
    chat?.providerId != null && activeModel
      ? { providerId: chat.providerId, model: activeModel }
      : undefined;

  const applySwitch = async (choice: ModelChoice) => {
    setProblem(chatId, undefined);
    try {
      const result = await api<{ chat: ChatSummary }>(`/api/chats/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify(choice),
      });
      setChat(result.chat);
    } catch (reason) {
      setProblem(chatId, message(reason));
    }
  };

  const startFresh = async (choice: ModelChoice) => {
    try {
      const { id } = await api<{ id: number }>("/api/chats", {
        method: "POST",
        body: JSON.stringify(choice),
      });
      router.replace({ pathname: "/chat/[id]", params: { id } });
    } catch (reason) {
      setProblem(chatId, message(reason));
    }
  };

  const chooseModel = (choice: ModelChoice) => {
    setPicking(false);
    if (
      !chat ||
      (activeChoice && choiceKey(choice) === choiceKey(activeChoice))
    )
      return;
    // Nothing said yet: there is no context to lose.
    if (items.length === 0) {
      void applySwitch(choice);
      return;
    }
    const target = allProviders.find(
      (provider) => provider.id === choice.providerId,
    );
    const canKeep = sameWireFormat(target?.kind, chat.kind);
    Alert.alert(
      `切换到 ${choice.model}`,
      canKeep
        ? "建议重置上下文：会开一个新对话让新模型从头开始，这段对话仍会保留。也可以把现有上下文交给新模型继续，但效果可能不稳定。"
        : "这个模型使用另一种消息格式，读不了这段对话的上下文，只能开一个新对话。这段对话仍会保留。",
      [
        { text: "重置上下文并切换", onPress: () => void startFresh(choice) },
        ...(canKeep
          ? [
              {
                text: "保留上下文切换",
                onPress: () => void applySwitch(choice),
              },
            ]
          : []),
        { text: "取消", style: "cancel" as const },
      ],
    );
  };

  const unavailable = chat?.providerId === null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={100}
    >
      <Stack.Screen options={{ title: chat?.title || "新对话" }} />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        keyboardDismissMode="interactive"
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        {error ? <ErrorNote>无法读取对话：{error}</ErrorNote> : null}
        {data && items.length === 0 ? (
          <Text
            style={{
              color: colors.mutedForeground,
              textAlign: "center",
              paddingVertical: 40,
            }}
          >
            可以问「这周还有哪些作业没交」，或者让它「把数据结构实验拆成几个学习块排进这周」。
          </Text>
        ) : null}
        {groupPending(items).map((entry) => {
          if (entry.type === "batch")
            return (
              <BatchCard
                key={entry.tools[0]!.id}
                tools={entry.tools}
                onDecision={(approve) =>
                  decideAll(
                    chatId,
                    entry.tools.map((tool) => tool.id),
                    approve,
                  )
                }
              />
            );
          const { item, index } = entry;
          return item.type === "user" ? (
            <View
              key={index}
              style={[styles.user, { backgroundColor: colors.secondary }]}
            >
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  color: colors.foreground,
                }}
              >
                {item.text}
              </Text>
            </View>
          ) : item.type === "assistant" ? (
            <Markdown key={index}>{item.text}</Markdown>
          ) : (
            <ToolCard
              key={item.id}
              item={item}
              onDecision={(approve) => decide(chatId, item.id, approve)}
            />
          );
        })}
        {isWaitingForReply(items, running, thinking) ? (
          <View style={[styles.typing, { backgroundColor: colors.muted }]}>
            <ActivityIndicator size="small" />
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.composer,
          { borderColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        {problem ? <ErrorNote>{problem}</ErrorNote> : null}
        <Pressable
          onPress={() => setPicking(true)}
          disabled={!chat || running}
          style={{ alignSelf: "flex-start" }}
        >
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
            {activeModel ?? "选择模型"} ▾
          </Text>
        </Pressable>
        {unavailable ? (
          <Text style={{ fontSize: 14, color: colors.mutedForeground }}>
            这段对话使用的模型服务已被删除，只能查看。可以换一个模型继续。
          </Text>
        ) : (
          <View
            style={[
              styles.inputRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={{
                flex: 1,
                fontSize: 16,
                maxHeight: 140,
                color: colors.foreground,
                paddingVertical: 8,
              }}
              placeholder="输入消息"
              placeholderTextColor={colors.mutedForeground}
              multiline
              value={draft}
              onChangeText={setDraft}
            />
            <Pressable
              accessibilityLabel="发送"
              disabled={running || !draft.trim()}
              onPress={() => send()}
              style={[
                styles.send,
                {
                  backgroundColor: colors.primary,
                  opacity: running || !draft.trim() ? 0.4 : 1,
                },
              ]}
            >
              {running ? (
                <ActivityIndicator
                  color={colors.primaryForeground}
                  size="small"
                />
              ) : (
                <Text
                  style={{
                    color: colors.primaryForeground,
                    fontSize: 18,
                    fontWeight: "700",
                  }}
                >
                  ↑
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </View>

      <ModelSheet
        visible={picking}
        providers={allProviders}
        lists={modelLists.data}
        value={activeChoice}
        onChoose={chooseModel}
        onClose={() => setPicking(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  user: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  tool: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  typing: {
    alignSelf: "flex-start",
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    paddingLeft: space.md,
    padding: 4,
    gap: space.sm,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
});
