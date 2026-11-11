/**
 * One assistant turn, independent of the model provider: ask the model, run
 * the tools it calls (pausing for the user's approval on writes), hand back
 * the results, and repeat until it answers in plain text.
 */
import type { Database } from "bun:sqlite";
import { DECLINED_MESSAGE } from "../../shared/chat";
import { findTool, runTool, type ToolDefinition } from "./tools";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Set when the model's arguments could not be parsed at all. */
  invalid?: string;
}

export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

/** What the browser is told while a turn runs. */
export type TurnEvent =
  | { type: "thinking" }
  | { type: "text"; delta: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: unknown;
      needsApproval: boolean;
    }
  | { type: "tool_result"; id: string; ok: boolean; declined?: boolean };

export type Emit = (event: TurnEvent) => void;

/** One row of a conversation as shown to the user. */
export type DisplayItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: unknown;
      /** Absent while the call is still waiting or running. */
      result?: { ok: boolean; content: string };
    };

/**
 * A conversation in one provider's wire format. Each adapter keeps its native
 * message list, which is what gets persisted and replayed unchanged.
 */
export interface Conversation {
  /** Appends the user's message. `now` is shown to the model as context. */
  addUser(text: string, now: Date): void;
  /** Requests one model response, streams it, and appends it to the history. */
  step(
    tools: ToolDefinition[],
    emit: Emit,
    signal: AbortSignal,
  ): Promise<ToolCall[]>;
  addToolResults(results: ToolResult[]): void;
  /** The provider-native messages, one array element per stored row. */
  messages(): unknown[];
  display(): DisplayItem[];
}

/** The turn could not be completed; nothing from it should be kept. */
export class TurnError extends Error {}

/** Resolves true to run a write the model asked for, false to decline it. */
export type Approve = (call: ToolCall) => Promise<boolean>;

const MAX_STEPS = 12;

export interface TurnOutcome {
  /** True when a tool changed schedule data during the turn. */
  changed: boolean;
}

export async function runTurn(
  db: Database,
  conversation: Conversation,
  tools: ToolDefinition[],
  emit: Emit,
  approve: Approve,
  signal: AbortSignal,
): Promise<TurnOutcome> {
  let changed = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const calls = await conversation.step(tools, emit, signal);
    if (calls.length === 0) return { changed };

    const results: ToolResult[] = [];
    for (const call of calls) {
      const tool = findTool(call.name);
      const needsApproval = tool?.write === true && call.invalid === undefined;
      emit({
        type: "tool_call",
        id: call.id,
        name: call.name,
        input: call.input,
        needsApproval,
      });

      if (call.invalid !== undefined) {
        // Hand the unparseable text back so the model can correct itself.
        results.push({
          id: call.id,
          isError: true,
          content: JSON.stringify({ INVALID_JSON: call.invalid }),
        });
        emit({ type: "tool_result", id: call.id, ok: false });
        continue;
      }

      if (needsApproval && !(await approve(call))) {
        results.push({ id: call.id, isError: true, content: DECLINED_MESSAGE });
        emit({ type: "tool_result", id: call.id, ok: false, declined: true });
        continue;
      }
      if (signal.aborted) throw new TurnError("已取消");

      const outcome = runTool(db, call.name, call.input);
      changed ||= outcome.changed;
      results.push({
        id: call.id,
        isError: outcome.isError,
        content: outcome.content,
      });
      emit({ type: "tool_result", id: call.id, ok: !outcome.isError });
    }
    // Every result of one model response goes back in a single message.
    conversation.addToolResults(results);
  }
  throw new TurnError("模型连续调用工具的次数过多，已停止");
}

export const SYSTEM_PROMPT = `你是 studyPal 里的学习助手，用户是一名浙江大学的学生。studyPal 是一个桌面应用，里面有用户的课程表、手动添加的日程、作业及截止时间，以及为完成作业安排的"学习块"。

你可以用工具读取这些数据，也可以添加日程、创建或修改学习块。涉及用户的日程、作业或时间安排时，先用工具查实际数据再回答，不要凭印象猜。

关于时间：所有时间都按北京时间（+08:00）理解和表达。每条用户消息前面会附上当时的时间。调用工具时使用带时区的 ISO 8601 格式。

关于安排学习：把一项作业拆成学习块时，先看作业的截止时间和这段时间的空档，把学习块放进空档，避开已有的课程和日程，并在截止时间之前留出余量。单个学习块通常 45 到 120 分钟比较合适。

关于提醒：创建日程或学习块时可以直接带上提醒，也可以用 set_reminders 给已有的日程、课程、考试、作业或学习块设置，提前量用分钟表示，一项可以有多个。用户说"提前半小时提醒我"之类的话时照做即可。提醒是通过系统日历发出的；如果工具结果里说系统日历写入没有开启，要如实告诉用户。

会改动数据的工具在执行前，应用会把具体内容展示给用户确认，所以你不需要先用文字再征求一次同意，直接调用即可。如果用户拒绝了某次操作，不要原样重试，问清楚他想怎么调整。

回答用简体中文，直接、简洁。`;

/** The context line prepended to each user message. */
export function timeContext(now: Date): string {
  const formatted = now.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `当前时间：${formatted}（北京时间）`;
}
