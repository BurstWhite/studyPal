import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  Sparkles,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  Assignment,
  AssignmentStatus,
} from "../server/routes/assignments";
import { cn } from "../lib/utils";
import { api, useQuery } from "./api";
import { fromDateTimeInput } from "./calendar/dates";
import { planPrompt, queuePrompt } from "./chat/pendingPrompt";
import { PageHeader } from "./PageHeader";

const HOUR_MS = 3_600_000;

/** How far away a deadline is, in words. */
export function describeRemaining(
  dueAt: string,
  now: Date,
): { text: string; urgent: boolean } {
  const remaining = new Date(dueAt).getTime() - now.getTime();
  if (remaining <= 0) return { text: "已截止", urgent: true };
  const hours = remaining / HOUR_MS;
  if (hours < 1)
    return {
      text: `还剩 ${Math.max(1, Math.round(hours * 60))} 分钟`,
      urgent: true,
    };
  if (hours < 48)
    return { text: `还剩 ${Math.round(hours)} 小时`, urgent: hours <= 24 };
  return { text: `还剩 ${Math.floor(hours / 24)} 天`, urgent: false };
}

function formatDue(dueAt: string): string {
  return new Date(dueAt).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function Row({
  item,
  onStatus,
  onDelete,
}: {
  item: Assignment;
  onStatus: (status: AssignmentStatus) => void;
  onDelete: () => void;
}) {
  const open = item.status === "open";
  const remaining =
    item.dueAt && open ? describeRemaining(item.dueAt, new Date()) : undefined;
  const [expanded, setExpanded] = useState(false);
  const [problem, setProblem] = useState<string>();
  const hasDetails = Boolean(
    item.description || item.attachments.length > 0 || item.url,
  );

  const openOnPlatform = () => {
    setProblem(undefined);
    api("/api/open-external", {
      method: "POST",
      body: JSON.stringify({ url: item.url }),
    }).catch((reason: unknown) =>
      setProblem(reason instanceof Error ? reason.message : String(reason)),
    );
  };

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          aria-label={`${item.title} 已完成`}
          checked={item.status === "done"}
          onChange={(event) => onStatus(event.target.checked ? "done" : "open")}
          className="size-4"
        />
        <div className="min-w-0 flex-1">
          {hasDetails ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className={cn(
                "flex max-w-full items-center gap-1 text-left text-sm font-medium",
                !open && "text-muted-foreground line-through",
              )}
            >
              {expanded ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{item.title}</span>
            </button>
          ) : (
            <div
              className={cn(
                "truncate text-sm font-medium",
                !open && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </div>
          )}
          <div className="truncate text-xs text-muted-foreground">
            {[
              item.course,
              item.dueAt ? `${formatDue(item.dueAt)} 截止` : "没有截止时间",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {remaining && (
          <span
            className={cn(
              "shrink-0 text-sm tabular-nums",
              remaining.urgent && "font-medium text-destructive",
            )}
          >
            {remaining.text}
          </span>
        )}
        {open && (
          <Button
            variant="ghost"
            size="sm"
            title="让助手把这项作业拆成学习块，排进空档"
            onClick={() => queuePrompt(planPrompt(item))}
          >
            <Sparkles />
            生成计划
          </Button>
        )}
        {item.source === "manual" ? (
          <Button variant="ghost" size="sm" onClick={onDelete}>
            删除
          </Button>
        ) : item.status === "dismissed" ? (
          <Button variant="ghost" size="sm" onClick={() => onStatus("open")}>
            恢复
          </Button>
        ) : (
          open && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onStatus("dismissed")}
            >
              忽略
            </Button>
          )
        )}
      </div>
      {expanded && (
        <div className="ml-7 mt-2 flex flex-col gap-2 border-l-2 pl-3 text-sm">
          {item.description ? (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {item.description}
            </p>
          ) : (
            <p className="text-muted-foreground">老师没有写作业说明。</p>
          )}
          {item.attachments.length > 0 && (
            <p className="text-muted-foreground">
              <span className="text-foreground">附件：</span>
              {item.attachments.join("、")}
            </p>
          )}
          {item.url && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={openOnPlatform}
            >
              <ExternalLink />
              在学在浙大打开
            </Button>
          )}
          {problem && (
            <p role="alert" className="text-destructive">
              {problem}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [due, setDue] = useState("");
  const [problem, setProblem] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(undefined);
    if (!title.trim()) {
      setProblem("请填写标题");
      return;
    }
    try {
      await api("/api/assignments", {
        method: "POST",
        body: JSON.stringify({
          title,
          course,
          dueAt: due ? fromDateTimeInput(due)?.toISOString() : null,
        }),
      });
      setTitle("");
      setCourse("");
      setDue("");
      onAdded();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mb-4 flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="作业标题"
          placeholder="手动添加一项作业"
          className="min-w-48 flex-1"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          aria-label="课程"
          placeholder="课程（可不填）"
          className="w-40"
          value={course}
          onChange={(event) => setCourse(event.target.value)}
        />
        <Input
          aria-label="截止时间"
          type="datetime-local"
          className="w-52"
          value={due}
          onChange={(event) => setDue(event.target.value)}
        />
        <Button type="submit">
          <Plus />
          添加
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </form>
  );
}

export function DeadlinesPage() {
  const { data, error, loading, reload } =
    useQuery<Assignment[]>("/api/assignments");
  const [problem, setProblem] = useState<string>();

  const run = async (action: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await action();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
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

  const open = data?.filter((item) => item.status === "open") ?? [];
  const closed = data?.filter((item) => item.status !== "open") ?? [];
  const rows = (items: Assignment[]) =>
    items.map((item) => (
      <Row
        key={item.id}
        item={item}
        onStatus={(status) => void setStatus(item, status)}
        onDelete={() => void remove(item)}
      />
    ));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="作业"
        description="学在浙大的待办会自动同步。在「设置」里开启系统日历后，截止前 48 小时和 24 小时各提醒一次。"
      />
      <AddForm onAdded={reload} />

      {(error ?? problem) && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error ? `无法读取作业：${error}` : problem}
        </p>
      )}
      {loading && !data && (
        <p className="text-sm text-muted-foreground">正在读取…</p>
      )}

      {data && open.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
          没有待完成的作业。在「设置」里登录浙大账号后会自动同步，也可以在上面手动添加。
        </div>
      )}
      {open.length > 0 && (
        <ul className="divide-y rounded-lg border">{rows(open)}</ul>
      )}

      {closed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            已完成或已忽略（{closed.length}）
          </summary>
          <ul className="mt-2 divide-y rounded-lg border">{rows(closed)}</ul>
        </details>
      )}
    </div>
  );
}
