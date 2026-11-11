import type { Progress, ProgressAssignment } from "../server/routes/study";
import { useQuery } from "./api";
import { PageHeader } from "./PageHeader";
import { UsagePanel } from "./usage/UsagePanel";

/** Whole hours and minutes, e.g. `3 小时 30 分`. */
function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} 分`;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * A thin progress track. The unfilled part is a lighter step of the same hue,
 * so the bar reads as one quantity out of a whole.
 */
function Meter({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const ratio = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done} / ${total}`}
      title={`${label}：${done} / ${total}`}
      className="h-2 w-full overflow-hidden rounded-full bg-chart-1/20"
    >
      <div
        className="h-full rounded-full bg-chart-1"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {detail && (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      )}
    </div>
  );
}

function AssignmentList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: ProgressAssignment[];
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[item.course, `${formatDue(item.dueAt)} 截止`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="w-40 shrink-0">
                {item.blocks === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    还没有安排学习块
                  </span>
                ) : (
                  <>
                    <div className="mb-1 text-right text-xs tabular-nums text-muted-foreground">
                      学习块 {item.blocksDone} / {item.blocks}
                    </div>
                    <Meter
                      done={item.blocksDone}
                      total={item.blocks}
                      label={`${item.title} 的学习块`}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Overview({ data }: { data: Progress }) {
  const { week } = data;
  const percent =
    week.blocks === 0
      ? null
      : Math.round((week.blocksDone / week.blocks) * 100);
  const planned = data.courses.filter((course) => course.blocks > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="col-span-2 rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">本周学习块完成率</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">
              {percent === null ? "—" : `${percent}%`}
            </span>
            <span className="text-sm text-muted-foreground">
              {week.blocks === 0
                ? "本周还没有安排学习块"
                : `已完成 ${week.blocksDone} / ${week.blocks} 个`}
            </span>
          </div>
          <div className="mt-3">
            <Meter
              done={week.blocksDone}
              total={week.blocks}
              label="本周学习块"
            />
          </div>
        </div>
        <Tile
          label="本周已学习"
          value={formatMinutes(week.minutesDone)}
          detail={`计划 ${formatMinutes(week.minutes)}`}
        />
        <Tile
          label="已逾期的作业"
          value={String(data.overdue.length)}
          detail={`未来 7 天到期 ${data.upcoming.length} 项`}
        />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium">各课程的学习块</h2>
        {planned.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            还没有和作业关联的学习块。在「作业」页点「生成计划」，或者在「对话」里让助手帮你安排。
          </p>
        ) : (
          <ul className="grid grid-cols-[minmax(6rem,14rem)_1fr_auto] items-center gap-x-4 gap-y-3 rounded-lg border p-4">
            {planned.map((course) => (
              <li key={course.course} className="contents">
                <span className="truncate text-sm">{course.course}</span>
                <Meter
                  done={course.blocksDone}
                  total={course.blocks}
                  label={course.course}
                />
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {course.blocksDone} / {course.blocks}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AssignmentList
        title="已逾期"
        empty="没有逾期的作业。"
        items={data.overdue}
      />
      <AssignmentList
        title="未来 7 天到期"
        empty="未来 7 天没有到期的作业。"
        items={data.upcoming}
      />
    </div>
  );
}

export function ProgressPage() {
  const { data, error, loading } = useQuery<Progress>("/api/progress");
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="进度"
        description="学习块的完成情况、快到期的作业，以及 AI 工具用量。"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          无法读取数据：{error}
        </p>
      )}
      {loading && !data && (
        <p className="text-sm text-muted-foreground">正在读取…</p>
      )}
      {data && <Overview data={data} />}
      <div className="mt-6">
        <UsagePanel />
      </div>
    </div>
  );
}
