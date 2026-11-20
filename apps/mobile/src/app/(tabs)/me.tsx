/** 我的: study progress, the ZJU account, model services and the calendar. */
import { api, useQuery } from "@studypal/client/api";
import type { SystemCalendarStatus } from "@studypal/core/calendar/system";
import type { TestResult } from "@studypal/core/llm/models";
import type { Provider, ProviderKind } from "@studypal/core/llm/store";
import type { Progress } from "@studypal/core/routes/study";
import type { AccountStatus, SyncLogEntry } from "@studypal/core/routes/zju";
import type { SyncResult } from "@studypal/core/zju/sync";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Image, StyleSheet, Switch, Text, View } from "react-native";
import { message, useReloadOnFocus } from "@/lib/useReloadOnFocus";
import {
  Button,
  EmptyNote,
  ErrorNote,
  Meter,
  Panel,
  Screen,
  TextField,
} from "@/ui/parts";
import { space, useColors } from "@/ui/theme";

export const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容",
  deepseek: "DeepSeek",
  opencode: "OpenCode（按量付费）",
  "opencode-go": "OpenCode Go",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分钟` : ""}`;
}

function Muted({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text
      style={{ fontSize: 13, lineHeight: 19, color: colors.mutedForeground }}
    >
      {children}
    </Text>
  );
}

function ProgressPanel({ data }: { data: Progress | undefined }) {
  const colors = useColors();
  if (!data) return null;
  const { week } = data;
  const planned = data.courses.filter((course) => course.blocks > 0);
  return (
    <Panel title="本周学习">
      <View style={styles.stats}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            {week.blocksDone}/{week.blocks}
          </Text>
          <Muted>学习块已完成</Muted>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            {formatMinutes(week.minutesDone)}
          </Text>
          <Muted>计划 {formatMinutes(week.minutes)}</Muted>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.statValue,
              {
                color:
                  data.overdue.length > 0
                    ? colors.destructive
                    : colors.foreground,
              },
            ]}
          >
            {data.overdue.length}
          </Text>
          <Muted>逾期作业</Muted>
        </View>
      </View>
      <Meter done={week.blocksDone} total={week.blocks} />
      {planned.length === 0 ? (
        <Muted>
          还没有和作业关联的学习块。在「作业」里点「生成计划」，或者在「对话」里让助手帮你安排。
        </Muted>
      ) : (
        planned.map((course) => (
          <View key={course.course} style={{ gap: 4, marginTop: space.xs }}>
            <View style={styles.between}>
              <Text
                numberOfLines={1}
                style={{ color: colors.foreground, flex: 1 }}
              >
                {course.course}
              </Text>
              <Muted>
                {course.blocksDone} / {course.blocks}
              </Muted>
            </View>
            <Meter done={course.blocksDone} total={course.blocks} />
          </View>
        ))
      )}
    </Panel>
  );
}

function SyncLine({
  label,
  unit,
  entry,
}: {
  label: string;
  unit: string;
  entry: SyncLogEntry | null;
}) {
  const colors = useColors();
  return (
    <View style={styles.between}>
      <Muted>{label}</Muted>
      <Text
        style={{
          flex: 1,
          textAlign: "right",
          fontSize: 13,
          color: entry && !entry.ok ? colors.destructive : colors.foreground,
        }}
      >
        {!entry
          ? "还没有同步过"
          : entry.ok
            ? `${formatWhen(entry.finishedAt)} 成功，${entry.itemCount ?? 0} ${unit}`
            : `${formatWhen(entry.finishedAt)} 失败：${entry.message ?? "未知原因"}`}
      </Text>
    </View>
  );
}

function ZjuAccount({ onSynced }: { onSynced: () => void }) {
  const { data, error, reload } = useQuery<AccountStatus>("/api/zju/account");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaImage, setCaptchaImage] = useState<string>();
  const [busy, setBusy] = useState<"saving" | "syncing" | "removing">();
  const [problem, setProblem] = useState<string>();

  const sync = async (answer?: string) => {
    setBusy("syncing");
    setProblem(undefined);
    try {
      const result = await api<SyncResult>("/api/zju/sync", {
        method: "POST",
        body: JSON.stringify(answer ? { captcha: answer } : {}),
      });
      setCaptchaImage(result.captcha?.imageDataUrl);
      setCaptcha("");
    } catch (reason) {
      setProblem(message(reason));
    } finally {
      setBusy(undefined);
      reload();
      onSynced();
    }
  };

  const save = async () => {
    setBusy("saving");
    setProblem(undefined);
    try {
      await api("/api/zju/account", {
        method: "PUT",
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      reload();
      await sync();
    } catch (reason) {
      setProblem(message(reason));
      setBusy(undefined);
    }
  };

  const remove = () =>
    Alert.alert("移除浙大账号？", "已同步的课表和作业会保留。", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: async () => {
          setBusy("removing");
          setProblem(undefined);
          try {
            await api("/api/zju/account", { method: "DELETE" });
            setCaptchaImage(undefined);
          } catch (reason) {
            setProblem(message(reason));
          } finally {
            setBusy(undefined);
            reload();
          }
        },
      },
    ]);

  return (
    <Panel title="浙大账号">
      <Muted>
        用统一身份认证登录，同步教务网的课表、考试和学在浙大的作业。密码只保存在这台手机的钥匙串里。
      </Muted>
      {error ? <ErrorNote>无法读取账号状态：{error}</ErrorNote> : null}

      {data && !data.username ? (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          <TextField
            label="学号"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            keyboardType="number-pad"
            value={username}
            onChangeText={setUsername}
          />
          <TextField
            label="密码"
            secureTextEntry
            textContentType="password"
            value={password}
            onChangeText={setPassword}
          />
          <Button
            title={
              busy === "saving"
                ? "正在登录…"
                : busy === "syncing"
                  ? "正在同步…"
                  : "登录并同步"
            }
            disabled={busy !== undefined || !username.trim() || !password}
            onPress={() => void save()}
          />
        </View>
      ) : null}

      {data?.username ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Text style={{ fontSize: 15 }}>
            <Muted>已登录：</Muted>
            {data.username}
          </Text>
          <SyncLine label="课表" unit="节课" entry={data.lastSync.timetable} />
          <SyncLine label="考试" unit="场考试" entry={data.lastSync.exams} />
          <SyncLine
            label="作业"
            unit="项待办"
            entry={data.lastSync.assignments}
          />
          <Muted>打开 App 时，距上次同步超过两小时会自动同步。</Muted>
          <View style={styles.buttons}>
            <Button
              title={busy === "syncing" ? "正在同步…" : "立即同步"}
              size="sm"
              disabled={busy !== undefined}
              onPress={() => void sync()}
            />
            <Button
              title="移除账号"
              size="sm"
              variant="plain"
              disabled={busy !== undefined}
              onPress={remove}
            />
          </View>
        </View>
      ) : null}

      {captchaImage ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Muted>教务网要求输入验证码才能查询课表</Muted>
          <Image
            source={{ uri: captchaImage }}
            style={{ width: 120, height: 40, borderRadius: 6 }}
            accessibilityLabel="验证码"
          />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            value={captcha}
            onChangeText={setCaptcha}
          />
          <Button
            title="提交"
            size="sm"
            disabled={busy !== undefined || !captcha.trim()}
            onPress={() => void sync(captcha)}
          />
        </View>
      ) : null}
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
    </Panel>
  );
}

type TestState = "running" | TestResult | undefined;

function Providers({
  data,
  error,
  reload,
}: {
  data: Provider[] | undefined;
  error: string | undefined;
  reload: () => void;
}) {
  const colors = useColors();
  const [problem, setProblem] = useState<string>();
  const [tests, setTests] = useState<Record<number, TestState>>({});

  const test = async (id: number) => {
    setTests((current) => ({ ...current, [id]: "running" }));
    let result: TestResult;
    try {
      result = await api<TestResult>(`/api/providers/${id}/test`, {
        method: "POST",
      });
    } catch (reason) {
      result = { ok: false, error: message(reason) };
    }
    setTests((current) => ({ ...current, [id]: result }));
  };
  const run = async (path: string, method: string) => {
    setProblem(undefined);
    try {
      await api(path, { method });
    } catch (reason) {
      setProblem(message(reason));
    }
    reload();
  };

  return (
    <Panel
      title="模型服务"
      action={
        <Button
          title="添加"
          size="sm"
          variant="plain"
          onPress={() => router.push("/provider-new")}
        />
      }
    >
      <Muted>
        「对话」使用这里添加的模型服务。API key
        只保存在这台手机的钥匙串里，请求直接从手机发往你填写的地址。
      </Muted>
      {error || problem ? (
        <ErrorNote>{error ? `无法读取模型服务：${error}` : problem}</ErrorNote>
      ) : null}
      {data && data.length === 0 ? (
        <EmptyNote>还没有模型服务。</EmptyNote>
      ) : null}
      {data?.map((provider) => {
        const state = tests[provider.id];
        return (
          <View
            key={provider.id}
            style={[styles.provider, { borderColor: colors.border }]}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: "500",
                color: colors.foreground,
              }}
            >
              {provider.name}
              {provider.isDefault ? (
                <Text style={{ color: colors.primary }}> 默认</Text>
              ) : null}
            </Text>
            <Muted>
              {KIND_LABEL[provider.kind]}
              {provider.model ? ` · ${provider.model}` : ""}
              {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
            </Muted>
            <View style={styles.buttons}>
              <Button
                title={state === "running" ? "测试中…" : "测试"}
                size="sm"
                variant="accent"
                disabled={state === "running"}
                onPress={() => void test(provider.id)}
              />
              {!provider.isDefault ? (
                <Button
                  title="设为默认"
                  size="sm"
                  variant="plain"
                  onPress={() =>
                    void run(`/api/providers/${provider.id}/default`, "POST")
                  }
                />
              ) : null}
              <Button
                title="删除"
                size="sm"
                variant="plain"
                onPress={() =>
                  Alert.alert(
                    `删除「${provider.name}」？`,
                    "API key 也会从钥匙串里删除。",
                    [
                      { text: "取消", style: "cancel" },
                      {
                        text: "删除",
                        style: "destructive",
                        onPress: () =>
                          void run(`/api/providers/${provider.id}`, "DELETE"),
                      },
                    ],
                  )
                }
              />
            </View>
            {state && state !== "running" ? (
              <Text
                style={{
                  fontSize: 13,
                  color: state.ok ? colors.primary : colors.destructive,
                }}
              >
                {state.ok
                  ? `连接正常：${state.model} 在 ${(state.latencyMs / 1000).toFixed(1)} 秒内回复${state.reply ? `「${state.reply}」` : ""}`
                  : state.error}
              </Text>
            ) : null}
          </View>
        );
      })}
    </Panel>
  );
}

function SystemCalendar() {
  const colors = useColors();
  const { data, error, reload } = useQuery<SystemCalendarStatus>(
    "/api/system-calendar",
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const call = async (path: string, init: RequestInit) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api(path, init);
    } catch (reason) {
      setProblem(message(reason));
    } finally {
      setBusy(false);
      reload();
    }
  };
  const last = data?.last;

  return (
    <Panel title="系统日历">
      <Muted>
        把课表、日程、学习块和作业截止时间写进手机日历里的「studyPal（iPhone）」，作业截止前
        48 小时和 24 小时由系统提醒。 如果 Mac 版已经在往 iCloud
        写，这里就不用再开，否则会重复。
      </Muted>
      {error ? <ErrorNote>无法读取状态：{error}</ErrorNote> : null}
      {data ? (
        <View style={styles.between}>
          <Text style={{ fontSize: 15, color: colors.foreground }}>
            {data.enabled ? "已开启，有改动时自动写入" : "未开启"}
          </Text>
          <Switch
            value={data.enabled}
            disabled={busy}
            trackColor={{ true: colors.primary }}
            onValueChange={(enabled) =>
              void call("/api/system-calendar", {
                method: "PUT",
                body: JSON.stringify({ enabled }),
              })
            }
          />
        </View>
      ) : null}
      {data?.enabled && last ? (
        <Text
          style={{
            fontSize: 13,
            color: last.ok ? colors.mutedForeground : colors.destructive,
          }}
        >
          {last.ok
            ? `${formatWhen(last.at)} 写入成功，日历里共 ${last.total ?? 0} 项`
            : `${formatWhen(last.at)} 写入失败：${last.message ?? "未知原因"}`}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        {data?.enabled ? (
          <Button
            title="检查并写入"
            size="sm"
            variant="accent"
            busy={busy}
            onPress={() =>
              void call("/api/system-calendar/push", { method: "POST" })
            }
          />
        ) : null}
        {data?.hasCalendar ? (
          <Button
            title="清除系统日历"
            size="sm"
            variant="plain"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "清除系统日历？",
                "会删除手机日历里整个「studyPal（iPhone）」日历和其中的提醒，并关闭写入。studyPal 里的数据不受影响。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "清除",
                    style: "destructive",
                    onPress: () =>
                      void call("/api/system-calendar/clear", {
                        method: "POST",
                      }),
                  },
                ],
              )
            }
          />
        ) : null}
      </View>
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
    </Panel>
  );
}

export default function MeScreen() {
  const progress = useQuery<Progress>("/api/progress");
  const providers = useQuery<Provider[]>("/api/providers");
  const health = useQuery<{ builtAt: string }>("/api/health");
  useReloadOnFocus(progress.reload, providers.reload);

  return (
    <Screen title="我的">
      <ProgressPanel data={progress.data} />
      <ZjuAccount onSynced={progress.reload} />
      <Providers {...providers} />
      <SystemCalendar />
      <Muted>studyPal {health.data?.builtAt ?? ""}</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: space.md },
  statValue: { fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  provider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    gap: 4,
  },
});
