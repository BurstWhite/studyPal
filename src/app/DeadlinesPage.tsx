import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  Assignment,
  AssignmentStatus,
} from "@studypal/core/routes/assignments";
import { cn } from "../lib/utils";
import { api, useQuery } from "@studypal/client/api";
import {
  assignmentLists,
  describeRemaining,
  formatDue,
  matchesQuery,
  remainingTone,
} from "@studypal/client/assignments";
import { fromDateTimeInput } from "@studypal/client/calendar/dates";
import { planPrompt, queuePrompt } from "@studypal/client/chat/pendingPrompt";
import { Chip, EmptyNote, PageHeader } from "./PageHeader";

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
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          type="checkbox"
          aria-label={`${item.title} 已完成`}
          checked={item.status === "done"}
          onChange={(event) => onStatus(event.target.checked ? "done" : "open")}
          className="size-[18px] shrink-0"
        />
        <div className="min-w-48 flex-1">
          {hasDetails ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className={cn(
                "flex max-w-full items-center gap-1 text-left text-[15px] font-medium hover:text-primary",
                !open && "text-muted-foreground line-through",
              )}
            >
              <span className="truncate">{item.title}</span>
              {expanded ? (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          ) : (
            <div
              className={cn(
                "truncate text-[15px] font-medium",
                !open && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </div>
          )}
          <div className="num mt-0.5 truncate text-xs text-muted-foreground">
            {[
              item.course,
              item.dueAt ? `${formatDue(item.dueAt)} 截止` : "没有截止时间",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {remaining && (
            <Chip
              tone={remainingTone(item.dueAt!, new Date())}
              className="mr-2"
            >
              {remaining.text}
            </Chip>
          )}
          {item.status === "dismissed" && <Chip className="mr-2">已忽略</Chip>}
          {open && (
            <Button
              // Only deadlines within a week get the outlined button.
              variant={
                item.dueAt &&
                remainingTone(item.dueAt, new Date()) !== "neutral"
                  ? "accent"
                  : "ghost"
              }
              size="sm"
              className="text-primary"
              title="让助手把这项作业拆成学习块，排进空档"
              onClick={() => queuePrompt(planPrompt(item))}
            >
              <Sparkles />
              生成计划
            </Button>
          )}
          {item.source === "manual" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={onDelete}
            >
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
                className="text-muted-foreground"
                onClick={() => onStatus("dismissed")}
              >
                忽略
              </Button>
            )
          )}
        </div>
      </div>
      {expanded && (
        <div className="ml-[30px] mt-3 flex flex-col gap-2 rounded-xl bg-muted/60 px-4 py-3 text-sm">
          {item.description ? (
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
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

function AddForm({
  onAdded,
  onCancel,
}: {
  onAdded: () => void;
  onCancel: () => void;
}) {
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
      className="mb-5 flex flex-col gap-2 rounded-2xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="作业标题"
          placeholder="作业标题"
          autoFocus
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
        <Button type="submit">添加</Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="取消添加"
          onClick={onCancel}
        >
          <X />
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

type Filter = "open" | "week" | "done" | "dismissed";

/** A titled group of rows inside the list. */
function Group({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section>
      <h2
        className={cn(
          "flex items-center gap-2 pb-1 text-[15px] font-semibold",
          tone === "danger" && "text-destructive",
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
        {title}
      </h2>
      <ul className="divide-y border-b">{children}</ul>
    </section>
  );
}

export function DeadlinesPage() {
  const { data, error, loading, reload } =
    useQuery<Assignment[]>("/api/assignments");
  const [problem, setProblem] = useState<string>();
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

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

  const now = Date.now();
  const needle = query.trim().toLowerCase();
  const matches = (item: Assignment) => matchesQuery(item, query);
  const lists = assignmentLists(data ?? [], now);
  const { open, thisWeek, done, dismissed } = lists;

  const tabs: { value: Filter; label: string; count: number }[] = [
    { value: "open", label: "待完成", count: open.length },
    { value: "week", label: "7 天内到期", count: thisWeek.length },
    { value: "done", label: "已完成", count: done.length },
    ...(dismissed.length > 0
      ? [
          {
            value: "dismissed" as const,
            label: "已忽略",
            count: dismissed.length,
          },
        ]
      : []),
  ];

  const rows = (items: Assignment[]) =>
    items
      .filter(matches)
      .map((item) => (
        <Row
          key={item.id}
          item={item}
          onStatus={(status) => void setStatus(item, status)}
          onDelete={() => void remove(item)}
        />
      ));

  // The open list is split by how soon each item is due.
  const { overdue, soon, later, undated } = lists;
  const groups: {
    icon: LucideIcon;
    title: string;
    items: Assignment[];
    tone?: "danger";
  }[] =
    filter === "open"
      ? [
          {
            icon: TriangleAlert,
            title: "已截止",
            items: overdue,
            tone: "danger",
          },
          { icon: CalendarClock, title: "7 天内到期", items: soon },
          { icon: Clock, title: "之后", items: later },
          { icon: Clock, title: "没有截止时间", items: undated },
        ]
      : [
          {
            icon:
              filter === "week" ? CalendarClock : filter === "done" ? Clock : X,
            title: tabs.find((tab) => tab.value === filter)!.label,
            items:
              filter === "week"
                ? thisWeek
                : filter === "done"
                  ? done
                  : dismissed,
          },
        ];
  const visible = groups
    .map((group) => ({ ...group, rows: rows(group.items) }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="作业"
        description="学在浙大的待办会自动同步。在「设置」里开启系统日历后，截止前 48 小时和 24 小时各提醒一次。"
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              添加作业
            </Button>
          )
        }
      />
      {adding && <AddForm onAdded={reload} onCancel={() => setAdding(false)} />}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="筛选作业"
          className="flex flex-wrap gap-1.5"
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={filter === tab.value}
              onClick={() => setFilter(tab.value)}
              className={cn(
                "h-8 whitespace-nowrap rounded-lg px-3 text-sm transition-colors",
                filter === tab.value
                  ? "bg-primary font-medium text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="num ml-1.5 opacity-80">{tab.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索作业或课程"
            placeholder="搜索作业或课程"
            className="h-8 pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {(error ?? problem) && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error ? `无法读取作业：${error}` : problem}
        </p>
      )}
      {loading && !data && (
        <p className="text-sm text-muted-foreground">正在读取…</p>
      )}

      {data && visible.length === 0 && (
        <EmptyNote>
          {needle
            ? `没有和「${query.trim()}」匹配的作业。`
            : filter === "open"
              ? "没有待完成的作业。在「设置」里登录浙大账号后会自动同步，也可以点「添加作业」手动添加。"
              : filter === "week"
                ? "7 天内没有到期的作业。"
                : "这里还是空的。"}
        </EmptyNote>
      )}
      <div className="flex flex-col gap-6">
        {visible.map((group) => (
          <Group
            key={group.title}
            icon={group.icon}
            title={`${group.title}（${group.rows.length}）`}
            tone={group.tone}
          >
            {group.rows}
          </Group>
        ))}
      </div>
    </div>
  );
}
