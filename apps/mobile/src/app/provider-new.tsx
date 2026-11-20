/** Sheet for adding a model service. */
import { api } from "@studypal/client/api";
import type { TestResult } from "@studypal/core/llm/models";
import type { ProviderKind } from "@studypal/core/llm/store";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { message } from "@/lib/useReloadOnFocus";
import { Button, ErrorNote, Segments, TextField } from "@/ui/parts";
import { space, useColors } from "@/ui/theme";

const KINDS: { value: ProviderKind; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "opencode-go", label: "OpenCode Go" },
  { value: "opencode", label: "OpenCode" },
  { value: "openai-compatible", label: "OpenAI 兼容" },
];

/** Shown as the Base URL placeholder; kinds with a built-in address may leave it blank. */
const BASE_URL_HINT: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  "openai-compatible": "https://example.com/v1",
  deepseek: "https://api.deepseek.com",
  opencode: "https://opencode.ai/inference/openai/v1",
  "opencode-go": "https://opencode.ai/inference/go/openai/v1",
};

export default function NewProviderSheet() {
  const colors = useColors();
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [test, setTest] = useState<"running" | TestResult>();
  const [offered, setOffered] = useState<{
    models: string[];
    error?: string;
  }>();

  // An old result says nothing about settings that have since changed.
  useEffect(() => setTest(undefined), [kind, baseUrl, apiKey]);

  // Shows whether the key works by listing the models it can use.
  useEffect(() => {
    setOffered(undefined);
    if (!apiKey.trim() || (kind === "openai-compatible" && !baseUrl.trim()))
      return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<string[]>("/api/providers/models", {
        method: "POST",
        body: JSON.stringify({ kind, baseUrl, apiKey }),
      })
        .then((models) => !cancelled && setOffered({ models }))
        .catch(
          (reason: unknown) =>
            !cancelled && setOffered({ models: [], error: message(reason) }),
        );
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, baseUrl, apiKey]);

  const runTest = async () => {
    setTest("running");
    try {
      setTest(
        await api<TestResult>("/api/providers/test", {
          method: "POST",
          body: JSON.stringify({ kind, name, baseUrl, apiKey }),
        }),
      );
    } catch (reason) {
      setTest({ ok: false, error: message(reason) });
    }
  };

  const save = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({ kind, name, baseUrl, apiKey }),
      });
      router.back();
    } catch (reason) {
      setProblem(message(reason));
      setBusy(false);
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
        添加模型服务
      </Text>
      <Segments value={kind} options={KINDS} onChange={setKind} />
      <TextField
        label="API key"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={apiKey}
        onChangeText={setApiKey}
      />
      <TextField
        label={
          kind === "openai-compatible"
            ? "Base URL"
            : "Base URL（可不填，默认官方地址）"
        }
        placeholder={BASE_URL_HINT[kind]}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={baseUrl}
        onChangeText={setBaseUrl}
      />
      <TextField
        label="显示名称（可不填）"
        value={name}
        onChangeText={setName}
      />
      {offered ? (
        <Text
          style={{
            fontSize: 13,
            color: offered.error ? colors.destructive : colors.mutedForeground,
          }}
        >
          {offered.error
            ? `获取模型列表失败：${offered.error}`
            : `已获取 ${offered.models.length} 个可用模型。对话时在输入框旁切换。`}
        </Text>
      ) : null}
      {test && test !== "running" ? (
        <Text
          style={{
            fontSize: 13,
            color: test.ok ? colors.primary : colors.destructive,
          }}
        >
          {test.ok
            ? `连接正常：${test.model} 在 ${(test.latencyMs / 1000).toFixed(1)} 秒内回复${test.reply ? `「${test.reply}」` : ""}`
            : test.error}
        </Text>
      ) : null}
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          title={test === "running" ? "正在测试…" : "测试连接"}
          variant="accent"
          disabled={test === "running" || !apiKey.trim()}
          onPress={() => void runTest()}
          style={{ flex: 1 }}
        />
        <Button
          title="添加"
          busy={busy}
          onPress={() => void save()}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );
}
