import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEntry } from "../server/calendar/store";
import type { StudyBlock } from "../server/routes/study";
import { cn } from "../lib/utils";
import { useQuery } from "./api";
import {
  addDays,
  formatRange,
  formatTime,
  isSameDay,
  startOfWeek,
  weekdayLabel,
} from "./calendar/dates";
import { BlockDialog } from "./calendar/BlockDialog";
import { ClearDialog } from "./calendar/ClearDialog";
import { EventDialog, type DialogTarget } from "./calendar/EventDialog";
import { allDayEntries, placeDay } from "./calendar/layout";
import { PageHeader } from "./PageHeader";

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** The grid opens scrolled to this hour. */
const FIRST_VISIBLE_HOUR = 7;

/** Marks calendar entries that stand for study blocks rather than events. */
const BLOCK_SOURCE = "study-block";

function entryColors(source: string): string {
  if (source === BLOCK_SOURCE) return "border-chart-4 bg-chart-4/15";
  if (source === "exam") return "border-destructive bg-destructive/10";
  return source === "manual"
    ? "border-chart-2 bg-chart-2/15"
    : "border-chart-1 bg-chart-1/15";
}

/** Presents a study block as a calendar entry so it shares the week layout. */
function blockEntry(block: StudyBlock): CalendarEntry {
  return {
    // Negative ids keep block entries from colliding with event ids.
    id: -block.id,
    source: BLOCK_SOURCE,
    title: block.title,
    location: null,
    notes: null,
    start: block.start,
    end: block.end,
    allDay: false,
    series: { startsAt: block.start, endsAt: block.end, rrule: null },
  };
}

export function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [dialog, setDialog] = useState<DialogTarget>();
  const [clearing, setClearing] = useState(false);
  const [openBlock, setOpenBlock] = useState<StudyBlock>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const range = `from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(addDays(weekStart, 7).toISOString())}`;
  const events = useQuery<CalendarEntry[]>(`/api/events?${range}`);
  const blocks = useQuery<StudyBlock[]>(`/api/study-blocks?${range}`);
  const error = events.error ?? blocks.error;
  const reload = () => {
    events.reload();
    blocks.reload();
  };
  const blocksById = useMemo(
    () => new Map((blocks.data ?? []).map((block) => [block.id, block])),
    [blocks.data],
  );
  const entries = useMemo(
    () => [...(events.data ?? []), ...(blocks.data ?? []).map(blockEntry)],
    [events.data, blocks.data],
  );

  const openEntry = (entry: CalendarEntry) => {
    if (entry.source === BLOCK_SOURCE) setOpenBlock(blocksById.get(-entry.id));
    else setDialog({ kind: "edit", entry });
  };
  const today = new Date();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: FIRST_VISIBLE_HOUR * HOUR_HEIGHT });
  }, []);

  const newAt = (day: Date, hour: number) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    setDialog({ kind: "new", start });
  };

  const newNow = () => {
    const sameWeek = isSameDay(startOfWeek(today), weekStart);
    const nextHour = Math.min(today.getHours() + 1, 23);
    newAt(sameWeek ? today : weekStart, sameWeek ? nextHour : 9);
  };

  const hasAllDay = entries.some((entry) => entry.allDay);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="日程"
        description={formatRange(weekStart)}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="上一周"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
            >
              本周
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一周"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
            >
              <ChevronRight />
            </Button>
            <Button variant="outline" onClick={() => setClearing(true)}>
              <Trash2 />
              清除
            </Button>
            <Button onClick={newNow}>
              <Plus />
              添加日程
            </Button>
          </div>
        }
      />

      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          无法读取日程：{error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
        {/* Weekday header, with all-day entries underneath. */}
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
          <div />
          {days.map((day) => (
            <div
              key={day.getTime()}
              className="border-l px-2 py-1.5 text-center text-sm"
            >
              <span className="text-muted-foreground">{weekdayLabel(day)}</span>{" "}
              <span
                className={cn(
                  "inline-block min-w-6 rounded-full px-1 font-medium",
                  isSameDay(day, today) && "bg-primary text-primary-foreground",
                )}
              >
                {day.getDate()}
              </span>
            </div>
          ))}
          {hasAllDay && (
            <>
              <div className="border-t px-1 py-1 text-right text-xs text-muted-foreground">
                全天
              </div>
              {days.map((day) => (
                <div
                  key={day.getTime()}
                  className="flex flex-col gap-0.5 border-l border-t p-0.5"
                >
                  {allDayEntries(entries, day).map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => openEntry(entry)}
                      className={cn(
                        "truncate rounded border-l-2 px-1 text-left text-xs",
                        entryColors(entry.source),
                      )}
                    >
                      {entry.title}
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Hour grid. */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div
            className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
            style={{ height: HOURS.length * HOUR_HEIGHT }}
          >
            <div className="relative">
              {HOURS.slice(1).map((hour) => (
                <div
                  key={hour}
                  className="absolute right-1 -translate-y-1/2 text-xs text-muted-foreground tabular-nums"
                  style={{ top: hour * HOUR_HEIGHT }}
                >
                  {String(hour).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {days.map((day) => (
              <div key={day.getTime()} className="relative border-l">
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    aria-label={`在 ${weekdayLabel(day)} ${hour}:00 添加日程`}
                    onClick={() => newAt(day, hour)}
                    className="absolute inset-x-0 border-t border-border/60 hover:bg-accent/60"
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}

                {placeDay(entries, day).map((placed) => {
                  const { entry } = placed;
                  const minutes = placed.endMinute - placed.startMinute;
                  const done =
                    entry.source === BLOCK_SOURCE &&
                    blocksById.get(-entry.id)?.done === true;
                  return (
                    <button
                      key={`${entry.source}-${entry.id}-${entry.start}`}
                      type="button"
                      onClick={() => openEntry(entry)}
                      className={cn(
                        "absolute flex flex-col justify-start overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-xs leading-tight",
                        entryColors(entry.source),
                        done && "opacity-60",
                      )}
                      style={{
                        top: (placed.startMinute / 60) * HOUR_HEIGHT + 1,
                        height: Math.max((minutes / 60) * HOUR_HEIGHT - 2, 16),
                        left: `calc(${(placed.column / placed.columns) * 100}% + 1px)`,
                        width: `calc(${100 / placed.columns}% - 2px)`,
                      }}
                    >
                      <div
                        className={cn(
                          "truncate font-medium",
                          done && "line-through",
                        )}
                      >
                        {done ? "✓ " : ""}
                        {entry.title}
                      </div>
                      {minutes >= 45 && (
                        <div className="truncate text-muted-foreground">
                          {formatTime(new Date(entry.start))}–
                          {formatTime(new Date(entry.end))}
                          {entry.location ? ` · ${entry.location}` : ""}
                        </div>
                      )}
                    </button>
                  );
                })}

                {isSameDay(day, today) && (
                  <div
                    className="pointer-events-none absolute inset-x-0 border-t-2 border-destructive"
                    style={{
                      top:
                        ((today.getHours() * 60 + today.getMinutes()) / 60) *
                        HOUR_HEIGHT,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {dialog && (
        <EventDialog
          key={dialog.kind === "edit" ? `edit-${dialog.entry.id}` : "new"}
          target={dialog}
          onClose={() => setDialog(undefined)}
          onSaved={() => {
            setDialog(undefined);
            reload();
          }}
        />
      )}
      {openBlock && (
        <BlockDialog
          key={openBlock.id}
          block={openBlock}
          onClose={() => setOpenBlock(undefined)}
          onChanged={() => {
            setOpenBlock(undefined);
            reload();
          }}
        />
      )}
      {clearing && (
        <ClearDialog
          onClose={() => setClearing(false)}
          onCleared={() => {
            setClearing(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
