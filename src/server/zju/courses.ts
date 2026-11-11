/** 学在浙大 (courses.zju.edu.cn): pending coursework. */
import type { HttpSession } from "./http";
import { SessionExpired } from "./zdbk";

const ENTRY_URL = "https://courses.zju.edu.cn/user/index";
const TODO_URL = "https://courses.zju.edu.cn/api/todos";

export interface Todo {
  id: string;
  title: string;
  course: string | null;
  /** ISO 8601 instant, or null when the item has no deadline. */
  dueAt: string | null;
  /** The platform's activity type, e.g. `homework` or `exam`. */
  kind: string | null;
  /** The activity's page on the course platform, when its course is known. */
  url: string | null;
}

export interface ActivityDetails {
  /** The assignment text, as plain text. Empty when the teacher wrote none. */
  description: string;
  /** Names of the attached files. */
  attachments: string[];
}

const MAX_DESCRIPTION_LENGTH = 4000;

/** Reduces the platform's rich-text HTML to readable plain text. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > MAX_DESCRIPTION_LENGTH
    ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…`
    : text;
}

/** Reads the description and attachment names out of an activity payload. */
export function parseActivity(payload: unknown): ActivityDetails {
  const activity = (
    typeof payload === "object" && payload !== null ? payload : {}
  ) as {
    description?: unknown;
    data?: { description?: unknown } | null;
    uploads?: unknown;
  };
  const html = [activity.data?.description, activity.description].find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "",
  );
  const uploads = Array.isArray(activity.uploads) ? activity.uploads : [];
  return {
    description: html ? htmlToText(html) : "",
    attachments: uploads.flatMap((upload) => {
      const name = (upload as { name?: unknown } | null)?.name;
      return typeof name === "string" && name ? [name] : [];
    }),
  };
}

/** The full record of one activity: its text and attachments. */
export async function fetchActivity(
  session: HttpSession,
  id: string,
): Promise<ActivityDetails> {
  const { response, body } = await session.request(
    `https://courses.zju.edu.cn/api/activities/${encodeURIComponent(id)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok)
    throw new Error(`学在浙大作业详情接口返回 HTTP ${response.status}`);
  try {
    return parseActivity(JSON.parse(body));
  } catch {
    throw new Error("学在浙大作业详情接口返回的不是 JSON");
  }
}

/** Walks the single sign-on redirect chain until courses issues a session. */
export async function coursesLogin(session: HttpSession): Promise<void> {
  const result = await session.follow(ENTRY_URL);
  const signedIn =
    result.response.ok &&
    result.url.hostname === "courses.zju.edu.cn" &&
    session.jar.get("session", TODO_URL) !== undefined;
  if (!signedIn) {
    throw new SessionExpired("学在浙大登录失败：统一身份认证凭据无效");
  }
}

/** Extracts the student's own to-dos from the `/api/todos` payload. */
export function parseTodos(payload: unknown): Todo[] {
  const list = (payload as { todo_list?: unknown } | null)?.todo_list;
  if (!Array.isArray(list)) throw new Error("学在浙大作业接口缺少 todo_list");

  const todos: Todo[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    // Teaching assistants also get grading tasks here; keep student work only.
    if (item.is_student !== true) continue;
    if (item.id === undefined || item.id === null) continue;

    const end =
      typeof item.end_time === "string" ? new Date(item.end_time) : undefined;
    const courseId =
      typeof item.course_id === "number" || typeof item.course_id === "string"
        ? String(item.course_id)
        : null;
    todos.push({
      id: String(item.id),
      title:
        typeof item.title === "string" && item.title
          ? item.title
          : "未命名作业",
      course: typeof item.course_name === "string" ? item.course_name : null,
      dueAt: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
      kind: typeof item.type === "string" && item.type ? item.type : null,
      url: courseId
        ? `https://courses.zju.edu.cn/course/${encodeURIComponent(courseId)}/learning-activity#/${encodeURIComponent(String(item.id))}`
        : null,
    });
  }
  return todos;
}

export async function fetchTodos(session: HttpSession): Promise<Todo[]> {
  const { response, body } = await session.request(TODO_URL, {
    headers: { Accept: "application/json" },
  });
  if (
    response.status === 401 ||
    response.status === 403 ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new SessionExpired("学在浙大登录态已失效");
  }
  if (!response.ok)
    throw new Error(`学在浙大作业接口返回 HTTP ${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new SessionExpired(
      "学在浙大作业接口返回的不是 JSON，登录态可能已失效",
    );
  }
  return parseTodos(payload);
}
