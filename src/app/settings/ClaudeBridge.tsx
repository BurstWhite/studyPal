import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState } from "react";
import type { UsageReport } from "../../server/routes/usage";
import type { BridgePreview } from "../../server/usage/bridge";
import { api, useQuery } from "../api";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
      {children}
    </pre>
  );
}

/** Opt-in display of Claude Code's 5-hour and 7-day limits. */
export function ClaudeBridge() {
  const usage = useQuery<UsageReport>("/api/usage");
  const [preview, setPreview] = useState<BridgePreview>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      usage.reload();
    }
  };

  const showPreview = () =>
    run(async () =>
      setPreview(await api<BridgePreview>("/api/usage/claude-bridge/preview")),
    );

  const install = () =>
    run(async () => {
      const { backup } = await api<{ backup: string | null }>(
        "/api/usage/claude-bridge",
        {
          method: "POST",
          body: JSON.stringify({ consent: true }),
        },
      );
      setPreview(undefined);
      setNotice(backup ? `已开启。原设置文件备份在 ${backup}` : "已开启。");
    });

  const uninstall = () =>
    run(async () => {
      await api("/api/usage/claude-bridge", { method: "DELETE" });
      setNotice("已关闭，状态栏设置已恢复原样。");
    });

  const bridge = usage.data?.claude.bridge;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude Code 额度显示</CardTitle>
        <CardDescription>
          Token 用量和 Codex 的额度不需要任何设置，「进度」页直接显示。Claude
          Code 的 5 小时 / 1
          周额度只提供给它的状态栏命令，所以要显示它，需要修改 Claude Code
          的状态栏设置。这是可选的。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {usage.error && (
          <p role="alert" className="text-sm text-destructive">
            无法读取状态：{usage.error}
          </p>
        )}

        {bridge && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">
              {bridge.installed ? "已开启" : "未开启"}
            </span>
            {bridge.installed ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void uninstall()}
              >
                关闭并恢复原设置
              </Button>
            ) : (
              !preview && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void showPreview()}
                >
                  查看将要做的修改
                </Button>
              )
            )}
          </div>
        )}

        {preview && !bridge?.installed && (
          <div className="flex flex-col gap-3 rounded-md border p-3 text-sm">
            <p>
              开启后会做下面三件事。你现有的状态栏会照常显示：新脚本保存一份数据后，会把同样的输入交给原来的命令。
            </p>
            <div>
              <p className="mb-1 font-medium">
                1. 修改 {preview.settingsPath} 里的 statusLine
              </p>
              <p className="mb-1 text-xs text-muted-foreground">
                修改前（会先整份备份这个文件）：
              </p>
              <Code>{preview.before}</Code>
              <p className="mb-1 mt-2 text-xs text-muted-foreground">
                修改后：
              </p>
              <Code>{preview.after}</Code>
            </div>
            <div>
              <p className="mb-1 font-medium">
                2. 新建脚本 {preview.scriptPath}
              </p>
              <Code>{preview.scriptContent}</Code>
            </div>
            <p>
              <span className="font-medium">
                3. 脚本每次运行时覆盖写入 {preview.capturePath}
              </span>
              <br />
              <span className="text-xs text-muted-foreground">
                内容是 Claude Code
                传给状态栏的数据（额度、当前项目目录、会话编号等），只有你的账户可读，不会上传。studyPal
                只读取其中的额度。
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                取消
              </Button>
              <Button disabled={busy} onClick={() => void install()}>
                同意并写入
              </Button>
            </div>
          </div>
        )}

        {notice && (
          <p className="break-all text-sm text-muted-foreground">{notice}</p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
