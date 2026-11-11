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
import { useState, type FormEvent } from "react";
import type { Provider, ProviderKind } from "../../server/llm/store";
import { api, useQuery } from "../api";

const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容",
  deepseek: "DeepSeek",
  opencode: "OpenCode",
};

/** The model suggested when a kind is chosen; empty where there is no obvious one. */
const DEFAULT_MODEL: Record<ProviderKind, string> = {
  anthropic: "claude-opus-5-5",
  "openai-compatible": "",
  deepseek: "deepseek-flash",
  opencode: "",
};

const MODEL_HINT: Record<ProviderKind, string> = {
  anthropic: "claude-opus-5-5",
  "openai-compatible": "服务商提供的模型名称",
  deepseek: "deepseek-flash 或 deepseek-v4-pro",
  opencode: "例如 kimi-k3、glm-5.3、deepseek-v4-pro",
};

/** Shown as the Base URL placeholder; kinds with a built-in address may leave it blank. */
const BASE_URL_HINT: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  "openai-compatible": "https://example.com/v1",
  deepseek: "https://api.deepseek.com",
  opencode: "https://opencode.ai/inference/openai/v1",
};

const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function AddProvider({ onAdded }: { onAdded: () => void }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL.anthropic);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const changeKind = (next: ProviderKind) => {
    // Swap the suggested model only if the user has not typed their own.
    if (model === DEFAULT_MODEL[kind]) setModel(DEFAULT_MODEL[next]);
    setKind(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      await api("/api/providers", {
        method: "POST",
        body: JSON.stringify({ kind, name, baseUrl, model, apiKey }),
      });
      setName("");
      setBaseUrl("");
      setApiKey("");
      // Back to the suggestion for this kind, so the next entry starts clean.
      setModel(DEFAULT_MODEL[kind]);
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
            onChange={(event) => changeKind(event.target.value as ProviderKind)}
          >
            <option value="anthropic">Anthropic（Claude）</option>
            <option value="deepseek">DeepSeek</option>
            <option value="opencode">OpenCode</option>
            <option value="openai-compatible">其他 OpenAI 兼容接口</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-model">模型</Label>
          <Input
            id="provider-model"
            placeholder={MODEL_HINT[kind]}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </div>
      </div>
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
      <div className="grid grid-cols-2 gap-3">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider-name">显示名称（可不填）</Label>
          <Input
            id="provider-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <Button type="submit" disabled={busy} className="self-start">
        添加
      </Button>
    </form>
  );
}

export function Providers() {
  const { data, error, reload } = useQuery<Provider[]>("/api/providers");
  const [problem, setProblem] = useState<string>();

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
          <ul className="divide-y rounded-md border">
            {data.map((provider) => (
              <li
                key={provider.id}
                className="flex items-center gap-3 px-3 py-2"
              >
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
                    {KIND_LABEL[provider.kind]} · {provider.model}
                    {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
                  </div>
                </div>
                {!provider.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(`/api/providers/${provider.id}/default`, "POST")
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
              </li>
            ))}
          </ul>
        )}
        <AddProvider onAdded={reload} />
      </CardContent>
    </Card>
  );
}
