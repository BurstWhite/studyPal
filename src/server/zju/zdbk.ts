/** The undergraduate academic system (zdbk.zju.edu.cn): weekly timetable. */
import type { HttpSession } from "./http";

const SSO_ENTRY =
  "https://zjuam.zju.edu.cn/cas/login?service=" +
  encodeURIComponent("https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html");
const TIMETABLE_URL = "https://zdbk.zju.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html";
const REFERER = "https://zdbk.zju.edu.cn/jwglxt/xtgl/index_initMenu.html";
const CAPTCHA_URL = "https://zdbk.zju.edu.cn/jwglxt/kaptcha";

/** The four teaching quarters, as the timetable query names them. */
export const SEASONS = ["1|秋", "1|冬", "2|春", "2|夏"] as const;
export type Season = (typeof SEASONS)[number];

/** One weekly slot of a course. */
export interface TimetableSlot {
  name: string;
  teacher: string | null;
  location: string | null;
  /** 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  /** First class period (1-based) and how many periods it lasts. */
  firstPeriod: number;
  periodCount: number;
  oddWeeks: boolean;
  evenWeeks: boolean;
  /** Runs in the first half (秋 / 春) and/or second half (冬 / 夏) of the term. */
  firstHalf: boolean;
  secondHalf: boolean;
}

/** The site wants a captcha before it answers; `image` is what to show. */
export class CaptchaRequired extends Error {
  constructor(
    readonly image: Uint8Array,
    readonly contentType: string,
  ) {
    super("教务网要求输入验证码");
  }
}

/** The single sign-on session is no longer accepted. */
export class SessionExpired extends Error {}

function looksLikeLoginPage(body: string): boolean {
  return (
    body.includes("cas/login") ||
    body.includes("login_ssologin") ||
    body.includes("统一身份认证")
  );
}

/**
 * Parses one `kbList` record. Returns undefined for records that are not a
 * confirmed, schedulable class.
 */
export function parseSlot(raw: unknown): TimetableSlot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const text = (key: string) =>
    record[key] === undefined || record[key] === null
      ? undefined
      : String(record[key]);

  // `kcb` packs name, class code, teacher and room into <br>-separated HTML.
  const block = text("kcb");
  if (!block || text("sfyjskc") === "1") return undefined;
  // Only classes whose enrollment is confirmed (`sfqd`) are real.
  if (text("sfqd") !== "1") return undefined;

  const dayOfWeek = Number(text("xqj"));
  const firstPeriod = Number(text("djj"));
  const periodCount = Number(text("skcd"));
  if (
    !Number.isInteger(dayOfWeek) ||
    dayOfWeek < 1 ||
    dayOfWeek > 7 ||
    !Number.isInteger(firstPeriod) ||
    firstPeriod < 1 ||
    !Number.isInteger(periodCount) ||
    periodCount < 1
  ) {
    return undefined;
  }

  const parts = /(.*?)<br>(.*?)<br>(.*?)<br>(.*?)zwf/.exec(block);
  const name = (parts?.[1] ?? block.split("<br>")[0] ?? "").trim();
  if (!name) return undefined;

  const weeks = text("dsz"); // "0" odd weeks only, "1" even weeks only
  const half = text("xxq") ?? "";
  return {
    name: name.replaceAll("(", "（").replaceAll(")", "）"),
    teacher: parts?.[3]?.trim() || null,
    location: parts?.[4]?.trim() || null,
    dayOfWeek,
    firstPeriod,
    periodCount,
    oddWeeks: weeks !== "1",
    evenWeeks: weeks !== "0",
    firstHalf: half.includes("秋") || half.includes("春"),
    secondHalf: half.includes("冬") || half.includes("夏"),
  };
}

/** Exchanges the single sign-on cookie for an academic-system session. */
export async function zdbkLogin(session: HttpSession): Promise<void> {
  const result = await session.follow(SSO_ENTRY);
  const signedIn =
    session.jar.get("JSESSIONID", TIMETABLE_URL) !== undefined &&
    session.jar.get("route", TIMETABLE_URL) !== undefined;
  if (!signedIn || result.url.hostname !== "zdbk.zju.edu.cn") {
    throw new SessionExpired("教务网登录失败：统一身份认证凭据无效");
  }
}

async function fetchCaptcha(session: HttpSession): Promise<CaptchaRequired> {
  const { response, bytes } = await session.requestBytes(
    `${CAPTCHA_URL}?time=${Date.now()}`,
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Error(`教务网验证码接口返回异常（HTTP ${response.status}）`);
  }
  return new CaptchaRequired(bytes, contentType);
}

/**
 * The slots of one quarter. `academicYear` looks like `2026-2027`.
 * Throws `CaptchaRequired` when the site demands a captcha; call again with
 * the user's answer on the same session.
 */
export async function fetchTimetable(
  session: HttpSession,
  academicYear: string,
  season: Season,
  captcha = "",
): Promise<TimetableSlot[]> {
  const { response, body } = await session.request(TIMETABLE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Referer: REFERER,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams({
      xnm: academicYear,
      xqm: season,
      captcha_value: captcha,
    }).toString(),
  });

  const redirected = response.status >= 300 && response.status < 400;
  if (
    response.status === 401 ||
    response.status === 403 ||
    redirected ||
    looksLikeLoginPage(body)
  ) {
    throw new SessionExpired("教务网登录态已失效");
  }
  if (!response.ok)
    throw new Error(`教务网课表接口返回 HTTP ${response.status}`);
  if (body.includes("captcha_error")) throw await fetchCaptcha(session);
  if (body.trim() === "null" || body.trim() === "") return [];

  let payload: { kbList?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("教务网课表接口返回的不是 JSON");
  }
  if (!Array.isArray(payload.kbList)) return [];
  return payload.kbList.flatMap((record) => parseSlot(record) ?? []);
}

/**
 * Combines the per-quarter results of one term. A course that spans both
 * halves is reported once per quarter and is merged into a single slot.
 */
export function mergeSlots(slots: TimetableSlot[]): TimetableSlot[] {
  const merged = new Map<string, TimetableSlot>();
  for (const slot of slots) {
    const key = [
      slot.name,
      slot.dayOfWeek,
      slot.firstPeriod,
      slot.periodCount,
      slot.oddWeeks,
      slot.evenWeeks,
      slot.location ?? "",
    ].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.firstHalf ||= slot.firstHalf;
      existing.secondHalf ||= slot.secondHalf;
    } else {
      merged.set(key, { ...slot });
    }
  }
  return [...merged.values()];
}

const EXAMS_URL =
  "https://zdbk.zju.edu.cn/jwglxt/xskscx/kscx_cxXsgrksIndex.html?doType=query&queryModel.showCount=5000";

export interface Exam {
  /** Stable identity: the course selection number plus which exam it is. */
  id: string;
  course: string;
  kind: "midterm" | "final";
  /** ISO 8601 with offset; exams are always Beijing time. */
  startsAt: string;
  endsAt: string;
  location: string | null;
  seat: string | null;
}

/**
 * Reads a date and time range out of text such as `2027年01月12日(08:00-10:00)`.
 * Returns undefined while the exam has no calendar date yet (the system then
 * says something like "考试周第3天").
 */
export function parseExamTime(
  text: string,
): { startsAt: string; endsAt: string } | undefined {
  const date = /(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/.exec(text);
  const time = /(\d{1,2}):(\d{2})\s*[-~－—–至]\s*(\d{1,2}):(\d{2})/.exec(text);
  if (!date || !time) return undefined;
  const pad = (value: string) => value.padStart(2, "0");
  const day = `${date[1]}-${pad(date[2]!)}-${pad(date[3]!)}`;
  const startsAt = `${day}T${pad(time[1]!)}:${time[2]}:00+08:00`;
  const endsAt = `${day}T${pad(time[3]!)}:${time[4]}:00+08:00`;
  if (
    Number.isNaN(Date.parse(startsAt)) ||
    Date.parse(endsAt) <= Date.parse(startsAt)
  ) {
    return undefined;
  }
  return { startsAt, endsAt };
}

/** The midterm and final exams of one course record that already have a date. */
export function parseExams(raw: unknown): Exam[] {
  if (typeof raw !== "object" || raw === null) return [];
  const record = raw as Record<string, unknown>;
  const text = (key: string) => {
    const value = record[key];
    return value === undefined || value === null || String(value).trim() === ""
      ? null
      : String(value).trim();
  };
  const selection = text("xkkh");
  if (!selection) return [];
  const course = (text("kcmc") ?? "未知课程")
    .replaceAll("(", "（")
    .replaceAll(")", "）");

  const exams: Exam[] = [];
  const add = (
    kind: Exam["kind"],
    timeKey: string,
    roomKey: string,
    seatKey: string,
  ) => {
    const time = parseExamTime(text(timeKey) ?? "");
    if (!time) return;
    exams.push({
      id: `${selection}|${kind}`,
      course,
      kind,
      ...time,
      location: text(roomKey),
      seat: text(seatKey),
    });
  };
  add("midterm", "qzkssj", "qzjsmc", "qzzwxh");
  add("final", "kssj", "jsmc", "zwxh");
  return exams;
}

/** Every scheduled exam the academic system lists for the student. */
export async function fetchExams(session: HttpSession): Promise<Exam[]> {
  const { response, body } = await session.request(EXAMS_URL, {
    method: "POST",
    headers: {
      Referer: REFERER,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const redirected = response.status >= 300 && response.status < 400;
  if (
    response.status === 401 ||
    response.status === 403 ||
    redirected ||
    looksLikeLoginPage(body)
  ) {
    throw new SessionExpired("教务网登录态已失效");
  }
  if (!response.ok)
    throw new Error(`教务网考试接口返回 HTTP ${response.status}`);

  let payload: { items?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("教务网考试接口返回的不是 JSON");
  }
  if (!Array.isArray(payload.items))
    throw new Error("教务网考试接口缺少 items");
  return payload.items.flatMap(parseExams);
}
