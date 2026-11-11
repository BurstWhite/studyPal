import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StudyBlock } from "../../server/routes/study";
import { api } from "../api";
import { fromDateTimeInput, toDateTimeInput, toLocalIso } from "./dates";

const fieldClass =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** View, reschedule, complete or delete one study block. */
export function BlockDialog({
  block,
  onClose,
  onChanged,
}: {
  block: StudyBlock;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(block.title);
  const [start, setStart] = useState(toDateTimeInput(new Date(block.start)));
  const [end, setEnd] = useState(toDateTimeInput(new Date(block.end)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const run = async (init: RequestInit) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api(`/api/study-blocks/${block.id}`, init);
      onChanged();
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const from = fromDateTimeInput(start);
    const to = fromDateTimeInput(end);
    if (!title.trim()) return setProblem("请填写标题");
    if (!from || !to) return setProblem("请填写开始和结束时间");
    if (to <= from) return setProblem("结束时间必须晚于开始时间");
    void run({
      method: "PATCH",
      body: JSON.stringify({
        title,
        startsAt: toLocalIso(from),
        endsAt: toLocalIso(to),
      }),
    });
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <form onSubmit={save} className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">学习块</h2>
          {block.assignmentTitle && (
            <p className="mt-1 text-sm text-muted-foreground">
              对应作业：
              {[block.course, block.assignmentTitle]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>

        <fieldset disabled={busy} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="block-title">标题</Label>
            <Input
              id="block-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="block-start">开始</Label>
              <input
                id="block-start"
                type="datetime-local"
                className={fieldClass}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="block-end">结束</Label>
              <input
                id="block-end"
                type="datetime-local"
                className={fieldClass}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void run({ method: "DELETE" })}
          >
            删除
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            onClick={() => dialogRef.current?.close()}
          >
            取消
          </Button>
          <Button type="submit" variant="outline" disabled={busy}>
            保存
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void run({
                method: "PATCH",
                body: JSON.stringify({ done: !block.done }),
              })
            }
          >
            {block.done ? "标为未完成" : "标为已完成"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
