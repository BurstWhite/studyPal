import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import type { ClearScope } from "../../server/calendar/store";
import { api, useQuery } from "../api";

const SCOPES: { scope: ClearScope; label: string; detail: string }[] = [
  {
    scope: "manual",
    label: "手动添加的日程",
    detail: "你自己在 studyPal 里添加的日程。",
  },
  {
    scope: "synced",
    label: "同步来的课表和考试",
    detail: "从教务网同步的课和考试。下次同步时会重新出现。",
  },
  { scope: "all", label: "全部日程", detail: "以上两类都清除。" },
];

export function ClearDialog({
  onClose,
  onCleared,
}: {
  onClose: () => void;
  onCleared: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { data: counts, error } =
    useQuery<Record<ClearScope, number>>("/api/events/clear");
  const [scope, setScope] = useState<ClearScope>("manual");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const count = counts?.[scope] ?? 0;

  const clear = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api("/api/events/clear", {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      onCleared();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <h2 className="text-lg font-semibold">清除日程</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        清除后无法恢复。作业和学习块不受影响；如果开启了系统日历，对应的条目也会从系统日历里移除。
      </p>

      <fieldset className="mt-4 flex flex-col gap-2" disabled={busy}>
        {SCOPES.map((option) => (
          <label
            key={option.scope}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-ring has-checked:bg-accent/50"
          >
            <input
              type="radio"
              name="clear-scope"
              className="mt-1"
              checked={scope === option.scope}
              onChange={() => setScope(option.scope)}
            />
            <span className="flex-1">
              <span className="flex justify-between text-sm font-medium">
                {option.label}
                <span className="tabular-nums text-muted-foreground">
                  {counts ? `${counts[option.scope]} 条` : ""}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {(error ?? problem) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error ? `无法读取日程数量：${error}` : problem}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => dialogRef.current?.close()}>
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={busy || count === 0}
          onClick={() => void clear()}
        >
          {count === 0 ? "没有可清除的日程" : `清除 ${count} 条`}
        </Button>
      </div>
    </dialog>
  );
}
