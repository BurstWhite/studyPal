// Only types and pure helpers are imported from the server side.
import { describeLead } from "../../server/reminders";

/** Describes a tool call in the user's terms, for the chat view. */

interface Summary {
  label: string;
  /** Details worth showing, e.g. each study block about to be created. */
  lines: string[];
}

type Input = Record<string, unknown>;

function when(start: unknown, end: unknown): string {
  const from = new Date(String(start));
  const to = new Date(String(end));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "";
  const day = from.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  const time = (date: Date) =>
    date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${day} ${time(from)}–${time(to)}`;
}

function range(input: Input): string[] {
  const text = when(input.from, input.to);
  if (!text) return [];
  const from = new Date(String(input.from));
  const to = new Date(String(input.to));
  const day = (date: Date) =>
    date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  return [`${day(from)} 至 ${day(to)}`];
}

/** "提醒：提前 1 天、提前 1 小时", or nothing when no reminders are given. */
function remindersLine(value: unknown): string {
  const list = Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : [];
  return list.length > 0 ? `提醒：${list.map(describeLead).join("、")}` : "";
}

const TARGET_LABEL: Record<string, string> = {
  event: "日程",
  assignment: "作业",
  study_block: "学习块",
};

export function summarizeTool(name: string, rawInput: unknown): Summary {
  const input = (
    typeof rawInput === "object" && rawInput !== null ? rawInput : {}
  ) as Input;
  switch (name) {
    case "list_events":
      return { label: "查看日程", lines: range(input) };
    case "list_assignments":
      return { label: "查看作业", lines: [] };
    case "find_free_slots":
      return { label: "查找空档", lines: range(input) };
    case "create_event":
      return {
        label: "添加日程",
        lines: [
          [
            String(input.title ?? ""),
            when(input.starts_at, input.ends_at),
            input.location,
          ]
            .filter(Boolean)
            .join(" · "),
          remindersLine(input.reminders_minutes_before),
        ].filter(Boolean),
      };
    case "create_study_blocks": {
      const blocks = Array.isArray(input.blocks)
        ? (input.blocks as Input[])
        : [];
      return {
        label: `创建 ${blocks.length} 个学习块`,
        lines: blocks.map((block) =>
          [
            String(block.title ?? ""),
            when(block.starts_at, block.ends_at),
            remindersLine(block.reminders_minutes_before),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      };
    }
    case "set_reminders": {
      const target = TARGET_LABEL[String(input.target)] ?? "条目";
      const line = remindersLine(input.minutes_before);
      return {
        label: line ? `给${target}设置提醒` : `取消${target}的提醒`,
        lines: [`${target} #${String(input.id ?? "?")}`, line].filter(Boolean),
      };
    }
    case "set_study_block_done":
      return {
        label:
          input.done === false
            ? "把学习块标记为未完成"
            : "把学习块标记为已完成",
        lines: [`学习块 #${String(input.id ?? "?")}`],
      };
    case "delete_study_block":
      return {
        label: "删除学习块",
        lines: [`学习块 #${String(input.id ?? "?")}`],
      };
    default:
      return { label: name, lines: [] };
  }
}
