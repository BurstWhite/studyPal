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
import type { SystemCalendarStatus } from "../server/calendar/system";
import type { AccountStatus, SyncLogEntry } from "../server/routes/zju";
import type { SyncResult } from "../server/zju/sync";
import { api, useQuery } from "./api";
import { PageHeader } from "./PageHeader";
import { Appearance } from "./settings/Appearance";
import { ClaudeBridge } from "./settings/ClaudeBridge";
import { Providers } from "./settings/Providers";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {!entry ? (
        <span className="text-muted-foreground">还没有同步过</span>
      ) : entry.ok ? (
        <span>
          {formatWhen(entry.finishedAt)} 同步成功，{entry.itemCount ?? 0} {unit}
        </span>
      ) : (
        <span className="text-right text-destructive">
          {formatWhen(entry.finishedAt)} 同步失败：{entry.message ?? "未知原因"}
        </span>
      )}
    </div>
  );
}

function ZjuAccount() {
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
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
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
      setProblem(reason instanceof Error ? reason.message : String(reason));
      setBusy(undefined);
    }
  };

  const remove = async () => {
    setBusy("removing");
    setProblem(undefined);
    try {
      await api("/api/zju/account", { method: "DELETE" });
      setCaptchaImage(undefined);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>浙大账号</CardTitle>
        <CardDescription>
          用统一身份认证登录，同步教务网的课表和考试安排，以及学在浙大的作业。密码只保存在本机的系统钥匙串里。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            无法读取账号状态：{error}
          </p>
        )}

        {data && !data.username && (
          <form
            onSubmit={(event) => void save(event)}
            className="flex max-w-sm flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zju-username">学号</Label>
              <Input
                id="zju-username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zju-password">密码</Label>
              <Input
                id="zju-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={busy !== undefined}
              className="self-start"
            >
              {busy === "saving"
                ? "正在登录…"
                : busy === "syncing"
                  ? "正在同步…"
                  : "登录并同步"}
            </Button>
          </form>
        )}

        {data?.username && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm">
                已登录：<span className="font-medium">{data.username}</span>
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy !== undefined}
                  onClick={() => void remove()}
                >
                  移除账号
                </Button>
                <Button
                  disabled={busy !== undefined}
                  onClick={() => void sync()}
                >
                  {busy === "syncing" ? "正在同步…" : "立即同步"}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-md border p-3">
              <SyncLine
                label="课表"
                unit="节课"
                entry={data.lastSync.timetable}
              />
              <SyncLine
                label="考试"
                unit="场考试"
                entry={data.lastSync.exams}
              />
              <SyncLine
                label="作业"
                unit="项待办"
                entry={data.lastSync.assignments}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              应用运行时每两小时自动同步一次。移除账号不会删除已同步的课表和作业。
            </p>
          </>
        )}

        {captchaImage && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sync(captcha);
            }}
            className="flex flex-col gap-2 rounded-md border p-3"
          >
            <Label htmlFor="zju-captcha">
              教务网要求输入验证码才能查询课表
            </Label>
            <div className="flex items-center gap-2">
              <img
                src={captchaImage}
                alt="验证码"
                className="h-9 rounded border"
              />
              <Input
                id="zju-captcha"
                className="w-32"
                autoComplete="off"
                value={captcha}
                onChange={(event) => setCaptcha(event.target.value)}
              />
              <Button
                type="submit"
                disabled={busy !== undefined || !captcha.trim()}
              >
                提交
              </Button>
            </div>
          </form>
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

function SystemCalendar() {
  const { data, error, reload } = useQuery<SystemCalendarStatus>(
    "/api/system-calendar",
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** True while the user is being asked to confirm clearing. */
  const [confirmingClear, setConfirmingClear] = useState(false);

  const call = async (path: string, init: RequestInit) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api(path, init);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      reload();
    }
  };
  const setEnabled = (enabled: boolean) =>
    call("/api/system-calendar", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });

  const last = data?.last;
  return (
    <Card>
      <CardHeader>
        <CardTitle>系统日历</CardTitle>
        <CardDescription>
          把课表、日程、学习块和作业截止时间写进系统日历里一个名为「studyPal」的日历。作业在截止前
          48 小时和 24 小时各有一次提醒，由系统发出，studyPal 不运行时也会响；用
          iCloud 的话会同步到 iPhone。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            无法读取状态：{error}
          </p>
        )}
        {data && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">
              {data.enabled ? "已开启，有改动时自动写入" : "未开启"}
            </span>
            <div className="flex gap-2">
              {data.enabled && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void call("/api/system-calendar/push", { method: "POST" })
                  }
                >
                  检查并写入
                </Button>
              )}
              <Button
                variant={data.enabled ? "outline" : "default"}
                disabled={busy}
                onClick={() => void setEnabled(!data.enabled)}
              >
                {busy ? "请稍候…" : data.enabled ? "关闭" : "开启"}
              </Button>
            </div>
          </div>
        )}
        {data?.enabled && last && (
          <p
            className={
              last.ok
                ? "text-sm text-muted-foreground"
                : "text-sm text-destructive"
            }
          >
            {last.ok
              ? `${formatWhen(last.at)} 写入成功，系统日历里共 ${last.total ?? 0} 项`
              : `${formatWhen(last.at)} 写入失败：${last.message ?? "未知原因"}`}
          </p>
        )}
        {data?.enabled && (
          <p className="text-sm text-muted-foreground">
            平时只写入有变化的内容。如果在「日历」里删掉了某些条目或整个日历，点「检查并写入」会把缺的补回去。
          </p>
        )}
        {data && !data.enabled && (
          <p className="text-sm text-muted-foreground">
            第一次开启时系统会询问是否允许访问日历。关闭后已写入的内容会留在系统日历里，可以用下面的「清除系统日历」删掉。
          </p>
        )}
        {data?.hasCalendar &&
          (confirmingClear ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3 text-sm">
              <p>
                会从系统日历里删除整个「studyPal」日历和其中的所有条目及提醒，并关闭写入。studyPal
                里的课表、日程和作业不受影响，之后重新开启会全部重新写入。
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmingClear(false)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingClear(false);
                    void call("/api/system-calendar/clear", { method: "POST" });
                  }}
                >
                  确认清除
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              disabled={busy}
              onClick={() => setConfirmingClear(true)}
            >
              清除系统日历
            </Button>
          ))}
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Which build is running, so an update can be confirmed at a glance. */
function BuildInfo() {
  const { data } = useQuery<{ builtAt: string }>("/api/health");
  if (!data) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {data.builtAt
        ? `当前版本构建于 ${new Date(data.builtAt).toLocaleString("zh-CN", { hour12: false })}`
        : "开发模式"}
    </p>
  );
}

export function SettingsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title="设置" description="账号、模型服务和可选功能。" />
      <ZjuAccount />
      <SystemCalendar />
      <Providers />
      <ClaudeBridge />
      <Appearance />
      <BuildInfo />
    </div>
  );
}
