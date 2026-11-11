import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CalendarEntry } from "../../server/calendar/store";
import { api } from "../api";
import {
  addDays,
  fromDateInput,
  fromDateTimeInput,
  toDateInput,
  toDateTimeInput,
  toLocalIso,
} from "./dates";

type Repeat = "none" | "daily" | "weekly" | "biweekly";

const REPEAT_RULES: Record<Exclude<Repeat, "none">, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
};

interface FormState {
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  /** `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` when all-day (end inclusive). */
  start: string;
  end: string;
  repeat: Repeat;
  /** `YYYY-MM-DD` of the last day the event repeats on; empty for no end. */
  until: string;
}

/** What the dialog is editing: an existing entry, or a new one at `start`. */
export type DialogTarget =
  { kind: "new"; start: Date } | { kind: "edit"; entry: CalendarEntry };

function readRepeat(rrule: string | null): { repeat: Repeat; until: string } {
  if (!rrule) return { repeat: "none", until: "" };
  const interval = /INTERVAL=(\d+)/.exec(rrule)?.[1] ?? "1";
  const repeat: Repeat = rrule.includes("FREQ=DAILY")
    ? "daily"
    : interval === "2"
      ? "biweekly"
      : "weekly";
  const match = /UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(
    rrule,
  );
  if (!match) return { repeat, until: "" };
  const [, y, mo, d, h, mi, s] = match;
  const until = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
  return { repeat, until: toDateInput(until) };
}

function initialState(target: DialogTarget): FormState {
  if (target.kind === "new") {
    const end = new Date(target.start.getTime() + 60 * 60_000);
    return {
      title: "",
      location: "",
      notes: "",
      allDay: false,
      start: toDateTimeInput(target.start),
      end: toDateTimeInput(end),
      repeat: "none",
      until: "",
    };
  }
  const { entry } = target;
  const start = new Date(entry.series.startsAt);
  const end = new Date(entry.series.endsAt);
  return {
    title: entry.title,
    location: entry.location ?? "",
    notes: entry.notes ?? "",
    allDay: entry.allDay,
    start: entry.allDay ? toDateInput(start) : toDateTimeInput(start),
    // All-day events are stored with an exclusive end; show the last day.
    end: entry.allDay ? toDateInput(addDays(end, -1)) : toDateTimeInput(end),
    ...readRepeat(entry.series.rrule),
  };
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Turns the form into an API request body, or returns a message to show. */
function toRequest(form: FormState): { body: object } | { problem: string } {
  if (!form.title.trim()) return { problem: "请填写标题" };

  const parse = form.allDay ? fromDateInput : fromDateTimeInput;
  const start = parse(form.start);
  let end = parse(form.end);
  if (!start || !end) return { problem: "请填写开始和结束时间" };
  if (form.allDay) end = addDays(end, 1);
  if (end <= start) return { problem: "结束时间必须晚于开始时间" };

  let rrule: string | null = null;
  if (form.repeat !== "none") {
    rrule = REPEAT_RULES[form.repeat];
    if (form.until) {
      const lastDay = fromDateInput(form.until);
      if (!lastDay) return { problem: "重复截止日期无效" };
      const until = new Date(addDays(lastDay, 1).getTime() - 1000);
      if (until < start) return { problem: "重复截止日期不能早于开始时间" };
      rrule += `;UNTIL=${utcStamp(until)}`;
    }
  }

  return {
    body: {
      title: form.title,
      location: form.location,
      notes: form.notes,
      allDay: form.allDay,
      startsAt: toLocalIso(start),
      endsAt: toLocalIso(end),
      rrule,
    },
  };
}

const fieldClass =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function EventDialog({
  target,
  onClose,
  onSaved,
}: {
  target: DialogTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(() => initialState(target));
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const existing = target.kind === "edit" ? target.entry : undefined;
  const readOnly = existing !== undefined && existing.source !== "manual";
  const repeats = existing?.series.rrule != null;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setProblem(undefined);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleAllDay = (allDay: boolean) =>
    setForm((current) => {
      const start = (current.allDay ? fromDateInput : fromDateTimeInput)(
        current.start,
      );
      const end = (current.allDay ? fromDateInput : fromDateTimeInput)(
        current.end,
      );
      if (!start || !end) return { ...current, allDay };
      if (allDay) {
        return {
          ...current,
          allDay,
          start: toDateInput(start),
          end: toDateInput(end),
        };
      }
      start.setHours(9, 0);
      end.setHours(10, 0);
      return {
        ...current,
        allDay,
        start: toDateTimeInput(start),
        end: toDateTimeInput(end),
      };
    });

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
      onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const request = toRequest(form);
    if ("problem" in request) {
      setProblem(request.problem);
      return;
    }
    void run(() =>
      existing
        ? api(`/api/events/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(request.body),
          })
        : api("/api/events", {
            method: "POST",
            body: JSON.stringify(request.body),
          }),
    );
  };

  const remove = () => {
    if (!existing) return;
    void run(() => api(`/api/events/${existing.id}`, { method: "DELETE" }));
  };

  const inputType = form.allDay ? "date" : "datetime-local";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">
          {existing ? (readOnly ? "日程详情" : "编辑日程") : "添加日程"}
        </h2>

        {readOnly && (
          <p className="text-sm text-muted-foreground">
            这条日程是同步来的，不能在这里修改。
          </p>
        )}
        {!readOnly && repeats && (
          <p className="text-sm text-muted-foreground">
            这是重复日程，修改或删除会应用到整个系列。
          </p>
        )}

        <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-title">标题</Label>
            <Input
              id="event-title"
              value={form.title}
              onChange={(event) => set("title", event.target.value)}
              autoFocus
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(event) => toggleAllDay(event.target.checked)}
            />
            全天
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-start">开始</Label>
              <input
                id="event-start"
                type={inputType}
                className={fieldClass}
                value={form.start}
                onChange={(event) => set("start", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-end">结束</Label>
              <input
                id="event-end"
                type={inputType}
                className={fieldClass}
                value={form.end}
                onChange={(event) => set("end", event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-repeat">重复</Label>
              <select
                id="event-repeat"
                className={fieldClass}
                value={form.repeat}
                onChange={(event) =>
                  set("repeat", event.target.value as Repeat)
                }
              >
                <option value="none">不重复</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="biweekly">每两周</option>
              </select>
            </div>
            {form.repeat !== "none" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="event-until">重复到（可不填）</Label>
                <input
                  id="event-until"
                  type="date"
                  className={fieldClass}
                  value={form.until}
                  onChange={(event) => set("until", event.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-location">地点</Label>
            <Input
              id="event-location"
              value={form.location}
              onChange={(event) => set("location", event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-notes">备注</Label>
            <Textarea
              id="event-notes"
              rows={2}
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>
        </fieldset>

        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}

        <div className="flex items-center gap-2">
          {existing && !readOnly && (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={remove}
            >
              删除
            </Button>
          )}
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            onClick={() => dialogRef.current?.close()}
          >
            {readOnly ? "关闭" : "取消"}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={busy}>
              保存
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
