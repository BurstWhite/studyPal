import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Plug, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { TestResult } from "../../server/llm/models";
import type { Provider, ProviderKind } from "../../server/llm/store";
import { cn } from "../../lib/utils";
import { api, useQuery } from "../api";

const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容",
  deepseek: "DeepSeek",
  opencode: "OpenCode（按量付费）",
  "opencode-go": "OpenCode Go",
};

/** Shown as the Base URL placeholder; kinds with a built-in address may leave it blank. */
const BASE_URL_HINT: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  "openai-compatible": "https://example.com/v1",
  deepseek: "https://api.deepseek.com",
  opencode: "https://opencode.ai/inference/openai/v1",
  "opencode-go": "https://opencode.ai/inference/go/openai/v1",
};

/** A connection test as shown: running, or how it went. */
type TestState = "running" | TestResult | undefined;

function TestOutcome({ state }: { state: TestState }) {
  if (!state) return null;
  if (state === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在发送测试消息…
      </span>
    );
  return (
    <span
      role="status"
      className={cn(
        "inline-flex min-w-0 items-start gap-1.5 text-xs",
        state.ok ? "text-primary" : "text-destructive",
      )}
    >
      {state.ok ? (
        <Check className="mt-px size-3.5 shrink-0" />
      ) : (
        <X className="mt-px size-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">
        {state.ok
          ? `连接正常：${state.model} 在 ${(state.latencyMs / 1000).toFixed(1)} 秒内回复${state.reply ? `「${state.reply}」` : ""}`
          : state.error}
      </span>
    </span>
  );
}

async function runTest(path: string, body?: unknown): Promise<TestResult> {
  try {
    return await api<TestResult>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function AddProvider({ onAdded }: { onAdded: () => void }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [test, setTest] = useState<TestState>();
  /** Models the service offers, once key and address are filled in. */
  const [offered, setOffered] = useState<{
    models: string[];
    error?: string;
  }>();

  // An old result says nothing about settings that have since changed.
  useEffect(() => setTest(undefined), [kind, baseUrl, apiKey]);

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
            !cancelled &&
            setOffered({
              models: [],
              error: reason instanceof Error ? reason.message : String(reason),
            }),
        );
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, baseUrl, apiKey]);

  const testDraft = async () => {
    setTest("running");
    setTest(
      await runTest("/api/providers/test", {
        kind,
        name,
        baseUrl,
        apiKey,
      }),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({ kind, name, baseUrl, apiKey }),
      });
      setName("");
      setBaseUrl("");
      setApiKey("");
      onAdded();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-kind">类型</Label>
          <select
            id="provider-kind"
            className={selectClass}
            value={kind}
            onChange={(event) => setKind(event.target.value as ProviderKind)}
          >
            <option value="anthropic">Anthropic（Claude）</option>
            <option value="deepseek">DeepSeek</option>
            <option value="opencode-go">OpenCode Go（订阅）</option>
            <option value="opencode">OpenCode（按量付费）</option>
            <option value="openai-compatible">其他 OpenAI 兼容接口</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-key">API key</Label>
          <Input
            id="provider-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-base-url">
            Base URL
            {kind === "openai-compatible" ? "" : "（可不填，默认官方地址）"}
          </Label>
          <Input
            id="provider-base-url"
            placeholder={BASE_URL_HINT[kind]}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-name">显示名称（可不填）</Label>
          <Input
            id="provider-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>
      {offered && (
        <p
          className={cn(
            "text-xs",
            offered.error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {offered.error
            ? `获取模型列表失败：${offered.error}`
            : `已获取 ${offered.models.length} 个可用模型。不用在这里选，对话时在输入框旁切换。`}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          添加
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={test === "running" || !apiKey.trim()}
          onClick={() => void testDraft()}
        >
          <Plug />
          测试连接
        </Button>
        <TestOutcome state={test} />
      </div>
    </form>
  );
}

export function Providers() {
  const { data, error, reload } = useQuery<Provider[]>("/api/providers");
  const [problem, setProblem] = useState<string>();
  const [tests, setTests] = useState<Record<number, TestState>>({});

  const testSaved = async (id: number) => {
    setTests((current) => ({ ...current, [id]: "running" }));
    const result = await runTest(`/api/providers/${id}/test`);
    setTests((current) => ({ ...current, [id]: result }));
  };

  const run = async (path: string, method: string) => {
    setProblem(undefined);
    try {
      await api(path, { method });
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
    reload();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>模型服务</CardTitle>
        <CardDescription>
          「对话」使用这里添加的模型服务。API key
          只保存在本机的系统钥匙串里，请求直接从本机发往你填写的地址。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {(error ?? problem) && (
          <p role="alert" className="text-sm text-destructive">
            {error ? `无法读取模型服务：${error}` : problem}
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {data.map((provider) => (
              <li key={provider.id} className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {provider.name}
                      {provider.isDefault && (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-normal">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {KIND_LABEL[provider.kind]}
                      {provider.model ? ` · ${provider.model}` : ""}
                      {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={tests[provider.id] === "running"}
                    onClick={() => void testSaved(provider.id)}
                  >
                    测试
                  </Button>
                  {!provider.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void run(
                          `/api/providers/${provider.id}/default`,
                          "POST",
                        )
                      }
                    >
                      设为默认
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(`/api/providers/${provider.id}`, "DELETE")
                    }
                  >
                    删除
                  </Button>
                </div>
                {tests[provider.id] && (
                  <div className="pt-1">
                    <TestOutcome state={tests[provider.id]} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <AddProvider onAdded={reload} />
      </CardContent>
    </Card>
  );
}
