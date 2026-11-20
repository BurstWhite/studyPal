/** 对话: the list of chats. A message handed over by another tab starts a new one. */
import { api, useQuery } from "@studypal/client/api";
import {
  forgetChat,
  onTurnFinished,
  useRunningChats,
} from "@studypal/client/chat/liveChats";
import { takePrompt } from "@studypal/client/chat/pendingPrompt";
import type { ChatSummary, Provider } from "@studypal/core/llm/store";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { message } from "@/lib/useReloadOnFocus";
import { Button, EmptyNote, ErrorNote, Panel, Screen } from "@/ui/parts";
import { space, useColors } from "@/ui/theme";

function openChat(id: number, initial?: string) {
  router.push({
    pathname: "/chat/[id]",
    params: initial ? { id, initial } : { id },
  });
}

function formatUpdated(value: string): string {
  const date = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function ChatListScreen() {
  const colors = useColors();
  const providers = useQuery<Provider[]>("/api/providers");
  const chats = useQuery<ChatSummary[]>("/api/chats");
  const running = useRunningChats();
  const [problem, setProblem] = useState<string>();

  // A finished turn retitles and reorders the list.
  const reloadChats = chats.reload;
  useEffect(() => onTurnFinished(reloadChats), [reloadChats]);

  const defaultProvider =
    providers.data?.find((provider) => provider.isDefault) ??
    providers.data?.[0];

  const create = async (initial?: string) => {
    if (!defaultProvider) return;
    setProblem(undefined);
    try {
      const { id } = await api<{ id: number }>("/api/chats", {
        method: "POST",
        body: JSON.stringify({
          providerId: defaultProvider.id,
          model: defaultProvider.model,
        }),
      });
      chats.reload();
      openChat(id, initial);
    } catch (reason) {
      setProblem(message(reason));
    }
  };

  useFocusEffect(
    useCallback(() => {
      providers.reload();
      chats.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // "生成计划" and "帮我安排今晚" on other tabs hand their prompt over here.
  useFocusEffect(
    useCallback(() => {
      if (!defaultProvider) return;
      const text = takePrompt();
      if (text) void create(text);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultProvider?.id]),
  );

  const remove = (chat: ChatSummary) =>
    Alert.alert(`删除「${chat.title || "新对话"}」？`, undefined, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/chats/${chat.id}`, { method: "DELETE" });
            forgetChat(chat.id);
          } catch (reason) {
            setProblem(message(reason));
          }
          chats.reload();
        },
      },
    ]);

  const error = providers.error ?? chats.error;
  return (
    <Screen
      title="对话"
      action={
        <Button
          title="新对话"
          size="sm"
          disabled={!defaultProvider}
          onPress={() => void create()}
        />
      }
    >
      {error || problem ? (
        <ErrorNote>{error ? `无法读取数据：${error}` : problem}</ErrorNote>
      ) : null}
      {providers.data?.length === 0 ? (
        <Panel>
          <EmptyNote>
            还没有可用的模型服务。先到「我的」里添加一个（需要 API
            key），再回来开始对话。
          </EmptyNote>
          <Button
            title="去添加"
            variant="accent"
            onPress={() => router.push("/provider-new")}
          />
        </Panel>
      ) : null}
      {chats.data && chats.data.length === 0 && providers.data?.length ? (
        <EmptyNote>
          可以问「这周还有哪些作业没交」，或者让它「把数据结构实验拆成几个学习块排进这周」。
        </EmptyNote>
      ) : null}
      {chats.data && chats.data.length > 0 ? (
        <Panel style={{ paddingVertical: space.xs }}>
          {chats.data.map((chat, index) => (
            <Pressable
              key={chat.id}
              onPress={() => openChat(chat.id)}
              onLongPress={() => remove(chat)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.6 },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 16, color: colors.foreground }}
                >
                  {chat.title || "新对话"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                  {formatUpdated(chat.updatedAt)}
                  {chat.model ? ` · ${chat.model}` : ""}
                </Text>
              </View>
              {running.includes(chat.id) ? <ActivityIndicator /> : null}
            </Pressable>
          ))}
        </Panel>
      ) : null}
      {chats.data && chats.data.length > 0 ? (
        <Text
          style={{
            fontSize: 12,
            color: colors.mutedForeground,
            textAlign: "center",
          }}
        >
          长按一段对话可以删除
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
  },
});
