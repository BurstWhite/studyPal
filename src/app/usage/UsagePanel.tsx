import type { UsageReport } from "../../server/routes/usage";
import type {
  Limits,
  LimitWindow,
  TokenWindows,
} from "../../server/usage/logs";
import { cn } from "../../lib/utils";
import { useQuery } from "../api";

/** Compact token counts: 950, 12.9K, 4.2M. */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000)
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
}

function formatReset(iso: string): string {
  const minutes = Math.max(
    0,
    Math.round((new Date(iso).getTime() - Date.now()) / 60_000),
  );
  if (minutes < 60) return `${minutes} 分钟后重置`;
  if (minutes < 48 * 60)
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后重置`;
  return `${Math.floor(minutes / (24 * 60))} 天后重置`;
}

/** The fill carries how close the limit is; the track is the same hue, lighter. */
function severity(percent: number) {
  if (percent >= 90)
    return { fill: "bg-red-600", track: "bg-red-600/20", note: "即将用完" };
  if (percent >= 75)
    return { fill: "bg-amber-500", track: "bg-amber-500/20", note: "用量较高" };
  return { fill: "bg-chart-2", track: "bg-chart-2/20", note: undefined };
}

function LimitMeter({
  label,
  window,
}: {
  label: string;
  window: LimitWindow | null;
}) {
  if (!window) {
    return (
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">
          这个周期内还没有用量记录
        </span>
      </div>
    );
  }
  const percent = Math.round(window.usedPercent);
  const level = severity(window.usedPercent);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span>
          {label}
          {level.note && (
            <span className="ml-2 text-xs text-muted-foreground">
              {level.note}
            </span>
          )}
        </span>
        <span className="tabular-nums">
          <span className="font-medium">{percent}%</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatReset(window.resetsAt)}
          </span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label}已用额度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
        aria-valuetext={`已用 ${percent}%`}
        className={cn("h-2 w-full overflow-hidden rounded-full", level.track)}
      >
        <div
          className={cn("h-full rounded-full", level.fill)}
          style={{ width: `${Math.min(100, window.usedPercent)}%` }}
        />
      </div>
    </div>
  );
}

function TokenTable({ tokens }: { tokens: TokenWindows }) {
  const rows: [string, TokenWindows[keyof TokenWindows]][] = [
    ["最近 5 小时", tokens.last5h],
    ["今天", tokens.today],
    ["最近 7 天", tokens.last7d],
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1 text-left font-normal">Token 用量</th>
          <th className="py-1 text-right font-normal">合计</th>
          <th className="py-1 text-right font-normal">输入</th>
          <th className="py-1 text-right font-normal">输出</th>
          <th className="py-1 text-right font-normal">缓存读取</th>
          <th className="py-1 text-right font-normal">请求数</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map(([label, totals]) => (
          <tr key={label} className="border-t">
            <td className="py-1.5">{label}</td>
            <td
              className="py-1.5 text-right font-medium"
              title={`${totals.total.toLocaleString()} tokens`}
            >
              {formatTokens(totals.total)}
            </td>
            <td className="py-1.5 text-right">
              {formatTokens(totals.input + totals.cacheWrite)}
            </td>
            <td className="py-1.5 text-right">{formatTokens(totals.output)}</td>
            <td className="py-1.5 text-right">
              {formatTokens(totals.cacheRead)}
            </td>
            <td className="py-1.5 text-right">
              {totals.requests.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ToolCard({
  name,
  found,
  tokens,
  limits,
  limitsHint,
}: {
  name: string;
  found: boolean;
  tokens: TokenWindows;
  limits: Limits | null;
  /** Shown in place of the meters when no limit data is available. */
  limitsHint: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <h3 className="text-sm font-medium">{name}</h3>
      {!found ? (
        <p className="text-sm text-muted-foreground">
          最近 7 天在这台电脑上没有找到 {name} 的使用记录。
        </p>
      ) : (
        <>
          {limits ? (
            <div className="flex flex-col gap-3">
              <LimitMeter label="5 小时额度" window={limits.fiveHour} />
              <LimitMeter label="1 周额度" window={limits.sevenDay} />
              <p className="text-xs text-muted-foreground">
                额度数据记录于{" "}
                {new Date(limits.capturedAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
                ，之后的用量要等下次使用 {name} 才会更新。
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{limitsHint}</p>
          )}
          <TokenTable tokens={tokens} />
        </>
      )}
    </div>
  );
}

/** Claude Code and Codex usage, read from their local logs. */
export function UsagePanel() {
  const { data, error } = useQuery<UsageReport>("/api/usage");
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">AI 工具用量</h2>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          无法读取用量：{error}
        </p>
      )}
      {data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ToolCard
            name="Claude Code"
            found={data.claude.found}
            tokens={data.claude.tokens}
            limits={data.claude.limits}
            limitsHint={
              data.claude.bridge.installed ? (
                "已开启额度显示，等 Claude Code 下一次回复后这里会出现数据。"
              ) : (
                <>
                  5 小时 / 1 周额度需要先在
                  <a href="#/settings" className="mx-1 underline">
                    设置
                  </a>
                  里开启（会修改 Claude Code
                  的状态栏设置，开启前可以查看具体改动）。
                </>
              )
            }
          />
          <ToolCard
            name="Codex"
            found={data.codex.found}
            tokens={data.codex.tokens}
            limits={data.codex.limits}
            limitsHint="当前周期内还没有额度记录，用一次 Codex 之后会出现。"
          />
        </div>
      )}
      {data && (
        <p className="mt-2 text-xs text-muted-foreground">
          数据来自这两个工具保存在本机的日志，只读取、不上传。"输入"包含写入缓存的部分。
        </p>
      )}
    </section>
  );
}
