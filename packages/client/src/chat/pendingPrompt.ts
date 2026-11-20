/**
 * Hands a message from another page to the chat page, which sends it in a
 * new conversation as soon as it opens.
 */
import type { Assignment } from "@studypal/core/routes/assignments";

let pending: string | undefined;
let openChat: () => void = () => {};

/** How each app switches to its chat page; set once at startup. */
export function setChatOpener(open: () => void): void {
  openChat = open;
}

/** Stores the prompt and switches to the chat page. */
export function queuePrompt(text: string): void {
  pending = text;
  openChat();
}

/** Returns the waiting prompt once, clearing it. */
export function takePrompt(): string | undefined {
  const text = pending;
  pending = undefined;
  return text;
}

/** The request sent for an assignment's "生成计划" button. */
export function planPrompt(assignment: Assignment): string {
  const due = assignment.dueAt
    ? new Date(assignment.dueAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : undefined;
  const details = [
    assignment.course ? `课程：${assignment.course}` : undefined,
    due ? `截止：${due}` : "没有截止时间",
    `作业编号：${assignment.id}`,
  ].filter(Boolean);
  return `请帮我为作业「${assignment.title}」制定学习计划（${details.join("，")}）。估计一下需要的总时间，把它拆成几个学习块，排进截止前的空档里。`;
}
