import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { openDatabase } from "../db";
import { listAssignments } from "../routes/assignments";
import { encryptPassword, loginPageError } from "./cas";
import { htmlToText, parseActivity, parseTodos } from "./courses";
import {
  CookieJar,
  HttpSession,
  metaRefreshTarget,
  type FetchLike,
} from "./http";
import {
  academicYearOf,
  expandSlot,
  parseSchoolCalendar,
} from "./schoolCalendar";
import { runSync, storeTodos } from "./sync";
import {
  mergeSlots,
  parseExams,
  parseExamTime,
  parseSlot,
  type TimetableSlot,
} from "./zdbk";

/** The published calendar of the 2026-2027 autumn-winter term. */
const CALENDAR_JSON = {
  sessionTime: [
    ["00:00", "00:00"],
    ["08:00", "08:45"],
    ["08:50", "09:35"],
    ["10:00", "10:45"],
    ["10:50", "11:35"],
    ["11:40", "12:25"],
    ["13:25", "14:10"],
    ["14:15", "15:00"],
    ["15:05", "15:50"],
    ["16:15", "17:00"],
    ["17:05", "17:50"],
    ["18:50", "19:35"],
    ["19:40", "20:25"],
    ["20:30", "21:15"],
    ["21:20", "22:05"],
    ["22:10", "22:55"],
  ],
  startEnd: ["20260914", "20261108", "20261109", "20270103"],
  holiday: { "20260925": "中秋节", "20261001": "国庆节", "20261005": "国庆节" },
  dummy: { "20260926": "中秋节" },
  exchange: {
    "2026100620260920": "国庆节",
    "2026100720261010": "国庆节",
    "2026100220261017": "国庆节",
    "2026123120270104": "学生节",
  },
};

const slot = (overrides: Partial<TimetableSlot> = {}): TimetableSlot => ({
  name: "数据结构",
  teacher: "张三",
  location: "紫金港东1-101",
  dayOfWeek: 1,
  firstPeriod: 1,
  periodCount: 2,
  oddWeeks: true,
  evenWeeks: true,
  firstHalf: true,
  secondHalf: false,
  ...overrides,
});

const record = (overrides: Record<string, unknown> = {}) => ({
  kcb: "数据结构<br>秋冬{第1-8周|2节/周}<br>张三<br>紫金港东1-101zwf",
  sfqd: "1",
  xqj: "1",
  djj: "1",
  skcd: "2",
  dsz: "2",
  xxq: "秋冬",
  ...overrides,
});

describe("cookie jar", () => {
  const url = (value: string) => new URL(value);

  test("domain cookies reach subdomains, host cookies do not", () => {
    const jar = new CookieJar();
    jar.store(
      ["sso=1; Domain=zju.edu.cn; Path=/"],
      url("https://zjuam.zju.edu.cn/cas/login"),
    );
    jar.store(
      ["JSESSIONID=abc; Path=/jwglxt"],
      url("https://zdbk.zju.edu.cn/jwglxt/x"),
    );

    expect(jar.header(url("https://courses.zju.edu.cn/api/todos"))).toBe(
      "sso=1",
    );
    expect(jar.header(url("https://zdbk.zju.edu.cn/jwglxt/kbcx/a.html"))).toBe(
      "sso=1; JSESSIONID=abc",
    );
    expect(jar.header(url("https://zdbk.zju.edu.cn/other"))).toBe("sso=1");
    expect(jar.header(url("https://notzju.edu.cn/"))).toBeUndefined();
    expect(jar.header(url("https://evilzju.edu.cn/"))).toBeUndefined();
  });

  test("a later value replaces the earlier one and expiry deletes", () => {
    const jar = new CookieJar();
    const at = url("https://courses.zju.edu.cn/");
    jar.store(["session=old"], at);
    jar.store(["session=new"], at);
    expect(jar.get("session", at.href)).toBe("new");
    jar.store(["session=x; Max-Age=0"], at);
    expect(jar.get("session", at.href)).toBeUndefined();
    jar.store(["session=y; Expires=Thu, 01 Jan 1970 00:00:00 GMT"], at);
    expect(jar.get("session", at.href)).toBeUndefined();
  });

  test("meta refresh is followed only to https ZJU hosts", () => {
    const base = url("https://courses.zju.edu.cn/a");
    const meta = (target: string) =>
      `<meta http-equiv="refresh" content="0;url=${target}">`;
    expect(metaRefreshTarget(meta("/user/index?a=1&amp;b=2"), base)?.href).toBe(
      "https://courses.zju.edu.cn/user/index?a=1&b=2",
    );
    expect(
      metaRefreshTarget(meta("https://evil.example/"), base),
    ).toBeUndefined();
    expect(metaRefreshTarget("<meta charset=utf-8>", base)).toBeUndefined();
  });
});

describe("login", () => {
  test("the encrypted password decrypts back to the password bytes", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 512 });
    const jwk = privateKey.export({ format: "jwk" });
    const hex = (value: string) =>
      Buffer.from(value, "base64url").toString("hex");
    const password = "p@ss 密码 123";

    const encrypted = encryptPassword(password, hex(jwk.n!), hex(jwk.e!));
    expect(encrypted).toHaveLength(128);

    let base = BigInt(`0x${encrypted}`);
    let exponent = BigInt(`0x${hex(jwk.d!)}`);
    const modulus = BigInt(`0x${hex(jwk.n!)}`);
    let plain = 1n;
    while (exponent > 0n) {
      if (exponent & 1n) plain = (plain * base) % modulus;
      base = (base * base) % modulus;
      exponent >>= 1n;
    }
    expect(Buffer.from(plain.toString(16), "hex").toString("utf8")).toBe(
      password,
    );
  });

  test("reads the message shown on a rejected login", () => {
    const page =
      '<p class="error text-left" id="errormsg" role="heading">\n <span>用户名或密码错误</span>\n</p>';
    expect(loginPageError(page)).toBe("用户名或密码错误");
    expect(loginPageError('<p id="errormsg">  </p>')).toBeUndefined();
    expect(loginPageError("<html></html>")).toBeUndefined();
  });
});

describe("timetable", () => {
  test("parses a timetable record", () => {
    expect(parseSlot(record())).toEqual(
      slot({ firstHalf: true, secondHalf: true }),
    );
    expect(parseSlot(record({ dsz: "0", xxq: "冬" }))).toMatchObject({
      oddWeeks: true,
      evenWeeks: false,
      firstHalf: false,
      secondHalf: true,
    });
    expect(
      parseSlot(record({ kcb: "形势与政策(I)<br>秋<br>李四<br>zwf" })),
    ).toMatchObject({
      name: "形势与政策（I）",
      teacher: "李四",
      location: null,
    });
  });

  test("skips records that are not confirmed classes", () => {
    expect(parseSlot(record({ sfqd: "0" }))).toBeUndefined();
    expect(parseSlot(record({ sfyjskc: "1" }))).toBeUndefined();
    expect(parseSlot(record({ kcb: null }))).toBeUndefined();
    expect(parseSlot(record({ djj: "x" }))).toBeUndefined();
    expect(parseSlot(null)).toBeUndefined();
  });

  test("a course reported in both quarters becomes one slot", () => {
    const merged = mergeSlots([
      slot({ firstHalf: true, secondHalf: false }),
      slot({ firstHalf: false, secondHalf: true }),
      slot({ dayOfWeek: 3 }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ firstHalf: true, secondHalf: true });
  });
});

describe("school calendar", () => {
  const calendar = parseSchoolCalendar(CALENDAR_JSON);
  const dates = (s: TimetableSlot) =>
    expandSlot(s, calendar).map((o) => o.date);

  test("rejects a calendar without term dates", () => {
    expect(() =>
      parseSchoolCalendar({ sessionTime: CALENDAR_JSON.sessionTime }),
    ).toThrow();
    expect(() =>
      parseSchoolCalendar({ ...CALENDAR_JSON, startEnd: ["2026"] }),
    ).toThrow();
  });

  test("a weekly class meets every week of its half, at the period times", () => {
    const occurrences = expandSlot(slot({ periodCount: 3 }), calendar);
    expect(occurrences.map((o) => o.date)).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]); // Monday 10-05 is a holiday
    expect(occurrences[0]).toEqual({
      date: "2026-09-14",
      startsAt: "2026-09-14T08:00:00+08:00",
      endsAt: "2026-09-14T10:45:00+08:00",
    });
  });

  test("odd and even weeks alternate, restarting in the second half", () => {
    expect(dates(slot({ dayOfWeek: 3, evenWeeks: false }))).toEqual([
      "2026-09-16",
      "2026-09-30",
      "2026-10-14",
      "2026-10-28",
    ]);
    expect(dates(slot({ dayOfWeek: 3, oddWeeks: false }))).toEqual([
      "2026-09-23",
      "2026-10-10",
      "2026-10-21",
      "2026-11-04",
    ]); // Wednesday 10-07 is made up on Saturday 10-10
    expect(
      dates(
        slot({
          dayOfWeek: 3,
          evenWeeks: false,
          firstHalf: false,
          secondHalf: true,
        }),
      ).slice(0, 2),
    ).toEqual(["2026-11-11", "2026-11-25"]);
  });

  test("classes on a swapped day move to the make-up day", () => {
    const tuesday = dates(slot({ dayOfWeek: 2 }));
    expect(tuesday).toContain("2026-09-20");
    expect(tuesday).not.toContain("2026-10-06");
    expect(tuesday).toHaveLength(8);
  });

  test("a class in both halves covers the whole term", () => {
    const all = dates(slot({ dayOfWeek: 4, secondHalf: true }));
    expect(all[0]).toBe("2026-09-17");
    expect(all).not.toContain("2026-10-01");
    expect(all).toContain("2027-01-04"); // Thursday 12-31 is made up on 01-04
    expect(all).toHaveLength(15);
  });

  test("a slot beyond the known periods yields nothing", () => {
    expect(
      expandSlot(slot({ firstPeriod: 15, periodCount: 2 }), calendar),
    ).toEqual([]);
  });

  test("the academic year turns over in September, Beijing time", () => {
    expect(academicYearOf(new Date("2026-11-10T00:00:00Z"))).toBe("2026-2027");
    expect(academicYearOf(new Date("2027-03-01T00:00:00Z"))).toBe("2026-2027");
    expect(academicYearOf(new Date("2026-08-31T15:59:00Z"))).toBe("2025-2026");
    expect(academicYearOf(new Date("2026-08-31T16:00:00Z"))).toBe("2026-2027");
  });
});

describe("exams", () => {
  test("reads the date and time range of a scheduled exam", () => {
    expect(parseExamTime("2027年01月12日(08:00-10:00)")).toEqual({
      startsAt: "2027-01-12T08:00:00+08:00",
      endsAt: "2027-01-12T10:00:00+08:00",
    });
    expect(parseExamTime("2026-11-7 14:00~16:00")).toEqual({
      startsAt: "2026-11-07T14:00:00+08:00",
      endsAt: "2026-11-07T16:00:00+08:00",
    });
  });

  test("an exam without a calendar date yet is left out", () => {
    expect(parseExamTime("考试周第3天(08:00-10:00)")).toBeUndefined();
    expect(parseExamTime("2027年01月12日")).toBeUndefined();
    expect(parseExamTime("2027年01月12日(10:00-08:00)")).toBeUndefined();
    expect(parseExamTime("")).toBeUndefined();
  });

  test("a course record yields its midterm and final", () => {
    const exams = parseExams({
      xkkh: "(2026-2027-1)-CS101-0001",
      kcmc: "数据结构(H)",
      qzkssj: "2026年11月07日(14:00-16:00)",
      qzjsmc: "紫金港东2-101",
      qzzwxh: "17",
      kssj: "2027年01月12日(08:00-10:00)",
      jsmc: "紫金港西1-202",
      zwxh: "",
    });
    expect(exams).toEqual([
      {
        id: "(2026-2027-1)-CS101-0001|midterm",
        course: "数据结构（H）",
        kind: "midterm",
        startsAt: "2026-11-07T14:00:00+08:00",
        endsAt: "2026-11-07T16:00:00+08:00",
        location: "紫金港东2-101",
        seat: "17",
      },
      {
        id: "(2026-2027-1)-CS101-0001|final",
        course: "数据结构（H）",
        kind: "final",
        startsAt: "2027-01-12T08:00:00+08:00",
        endsAt: "2027-01-12T10:00:00+08:00",
        location: "紫金港西1-202",
        seat: null,
      },
    ]);
    // No selection number, or no dated exam: nothing to store.
    expect(
      parseExams({ kcmc: "x", kssj: "2027年01月12日(08:00-10:00)" }),
    ).toEqual([]);
    expect(
      parseExams({ xkkh: "a", kcmc: "x", kssj: "考试周第2天(08:00-10:00)" }),
    ).toEqual([]);
    expect(parseExams(null)).toEqual([]);
  });
});

describe("assignment details", () => {
  test("turns rich text into plain text", () => {
    expect(
      htmlToText(
        "<p>完成<b>第三章</b>习题&nbsp;1&ndash;5</p><ul><li>提交 PDF</li><li>A &amp; B &lt;组&gt;</li></ul><script>alert(1)</script><br>截止前提交",
      ),
    ).toBe("完成第三章习题 1&ndash;5\n- 提交 PDF\n- A & B <组>\n\n截止前提交");
    expect(htmlToText("  <div> </div> ")).toBe("");
    expect(htmlToText("x".repeat(5000))).toHaveLength(4001);
  });

  test("reads the description and attachment names from an activity", () => {
    expect(
      parseActivity({
        id: 11,
        data: { description: "<p>实现二叉树的遍历</p>" },
        uploads: [
          { id: 1, name: "实验指导.pdf" },
          { id: 2 },
          "junk",
          { name: "模板.zip" },
        ],
      }),
    ).toEqual({
      description: "实现二叉树的遍历",
      attachments: ["实验指导.pdf", "模板.zip"],
    });
    // Some activities carry the text at the top level, or none at all.
    expect(
      parseActivity({
        description: "<p>顶层说明</p>",
        data: { description: "" },
      }).description,
    ).toBe("顶层说明");
    expect(parseActivity({})).toEqual({ description: "", attachments: [] });
    expect(parseActivity(null)).toEqual({ description: "", attachments: [] });
  });
});

describe("coursework", () => {
  test("keeps the student's own items and normalises deadlines", () => {
    const todos = parseTodos({
      todo_list: [
        {
          id: 11,
          title: "实验三",
          course_name: "数据结构",
          course_id: 778,
          type: "homework",
          end_time: "2026-11-20T15:59:00Z",
          is_student: true,
        },
        {
          id: 12,
          title: "批改作业",
          course_name: "程序设计",
          end_time: "2026-11-21T15:59:00Z",
          is_student: false,
        },
        {
          id: 13,
          title: "",
          course_name: "线性代数",
          end_time: null,
          is_student: true,
        },
        "garbage",
      ],
    });
    expect(todos).toEqual([
      {
        id: "11",
        title: "实验三",
        course: "数据结构",
        dueAt: "2026-11-20T15:59:00.000Z",
        kind: "homework",
        url: "https://courses.zju.edu.cn/course/778/learning-activity#/11",
      },
      // Without a course id there is no page to link to.
      {
        id: "13",
        title: "未命名作业",
        course: "线性代数",
        dueAt: null,
        kind: null,
        url: null,
      },
    ]);
    expect(() => parseTodos({})).toThrow();
  });

  test("storing keeps status, re-arms reminders on a new deadline, closes vanished items", () => {
    const db = openDatabase(":memory:");
    const todo = (id: string, dueAt: string | null) => ({
      id,
      title: `作业${id}`,
      course: "课",
      dueAt,
      kind: "homework",
      url: null,
    });
    storeTodos(db, [
      todo("1", "2026-11-20T15:59:00.000Z"),
      todo("2", null),
      todo("3", null),
    ]);
    db.exec(
      "UPDATE assignments SET notified_48h = 1 WHERE source_id IN ('1', '2')",
    );
    db.exec(
      "UPDATE assignments SET status = 'dismissed' WHERE source_id = '2'",
    );

    storeTodos(db, [todo("1", "2026-11-25T15:59:00.000Z"), todo("2", null)]);
    const rows = db
      .query(
        "SELECT source_id, status, due_at, notified_48h FROM assignments ORDER BY source_id",
      )
      .all();
    expect(rows).toEqual([
      {
        source_id: "1",
        status: "open",
        due_at: "2026-11-25T15:59:00.000Z",
        notified_48h: 0,
      },
      { source_id: "2", status: "dismissed", due_at: null, notified_48h: 1 },
      { source_id: "3", status: "done", due_at: null, notified_48h: 0 },
    ]);
  });
});

/**
 * A stand-in for the ZJU sites: unified login, the academic system behind a
 * service ticket, 学在浙大 behind a redirect chain with a meta refresh, and
 * the term calendar.
 */
function fakeZju(options: {
  password: string;
  captcha?: string;
  todos: unknown[];
  /** Activity ids whose detail request fails. */
  brokenActivities?: number[];
}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 512 });
  const jwk = privateKey.export({ format: "jwk" });
  const hex = (value: string) =>
    Buffer.from(value, "base64url").toString("hex");
  const state = {
    todos: options.todos,
    timetableCalls: 0,
    loginAttempts: 0,
    activityCalls: [] as string[],
  };

  const decrypt = (cipher: string) => {
    let base = BigInt(`0x${cipher}`);
    let exponent = BigInt(`0x${hex(jwk.d!)}`);
    const modulus = BigInt(`0x${hex(jwk.n!)}`);
    let plain = 1n;
    while (exponent > 0n) {
      if (exponent & 1n) plain = (plain * base) % modulus;
      base = (base * base) % modulus;
      exponent >>= 1n;
    }
    return Buffer.from(plain.toString(16), "hex").toString("utf8");
  };

  const redirect = (location: string, cookies: string[] = []) => {
    const headers = new Headers({ Location: location });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 302, headers });
  };
  const html = (body: string, cookies: string[] = []) => {
    const headers = new Headers({ "Content-Type": "text/html" });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    return new Response(body, { headers });
  };

  const fetchImpl: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const cookies = new Headers(init.headers).get("cookie") ?? "";
    const has = (pair: string) => cookies.split("; ").includes(pair);
    const route = `${url.hostname}${url.pathname}`;

    if (route === "calendar.celechron.top/2026-2027-1.json")
      return Response.json(CALENDAR_JSON);
    if (url.hostname === "calendar.celechron.top")
      return new Response("<Code>NoSuchKey</Code>", { status: 404 });

    if (route === "zjuam.zju.edu.cn/cas/v2/getPubKey") {
      return Response.json({ modulus: hex(jwk.n!), exponent: hex(jwk.e!) });
    }
    if (route === "zjuam.zju.edu.cn/cas/login") {
      const service = url.searchParams.get("service");
      if (service) {
        if (!has("iPlanetDirectoryPro=SSO"))
          return html('<form><input name="username"></form>');
        return redirect(
          `${service.replace("https://", "http://")}?ticket=ST-1`,
        );
      }
      if (init.method !== "POST") {
        return html('<input type="hidden" name="execution" value="EXEC-1" />', [
          "JSESSIONID=cas; Path=/cas",
        ]);
      }
      state.loginAttempts++;
      const form = new URLSearchParams(String(init.body));
      const ok =
        has("JSESSIONID=cas") &&
        form.get("execution") === "EXEC-1" &&
        form.get("username") === "3200100001" &&
        decrypt(form.get("password")!) === options.password;
      if (!ok)
        return html(
          '<p class="error" id="errormsg"><span>用户名或密码错误</span></p>',
        );
      return redirect("/cas/index", [
        "iPlanetDirectoryPro=SSO; Domain=zju.edu.cn; Path=/",
      ]);
    }

    if (route === "zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html") {
      if (url.searchParams.get("ticket") !== "ST-1")
        return new Response("no ticket", { status: 403 });
      return html("ok", ["JSESSIONID=zdbk; Path=/jwglxt", "route=r1; Path=/"]);
    }
    if (route === "zdbk.zju.edu.cn/jwglxt/kaptcha") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    if (route === "zdbk.zju.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html") {
      state.timetableCalls++;
      if (!has("JSESSIONID=zdbk") || !has("route=r1"))
        return redirect("https://zjuam.zju.edu.cn/cas/login");
      const form = new URLSearchParams(String(init.body));
      if (options.captcha && form.get("captcha_value") !== options.captcha) {
        return new Response('"captcha_error"');
      }
      if (form.get("xnm") !== "2026-2027") return new Response("null");
      if (form.get("xqm") === "1|秋") {
        return Response.json({
          kbList: [record(), record({ xqj: "4", sfqd: "0" })],
        });
      }
      if (form.get("xqm") === "1|冬")
        return Response.json({ kbList: [record()] });
      return new Response("null");
    }

    if (route === "courses.zju.edu.cn/user/index") {
      if (has("session=S1")) return html("<html>index</html>");
      if (url.searchParams.get("ticket") === "ST-2") {
        return html('<meta http-equiv="refresh" content="0;url=/user/index">', [
          "session=S1; Path=/",
        ]);
      }
      return redirect("https://identity.zju.edu.cn/auth?next=courses");
    }
    if (route === "identity.zju.edu.cn/auth") {
      if (!has("iPlanetDirectoryPro=SSO")) return html("login please");
      return redirect("https://courses.zju.edu.cn/user/index?ticket=ST-2");
    }
    if (route === "zdbk.zju.edu.cn/jwglxt/xskscx/kscx_cxXsgrksIndex.html") {
      if (!has("JSESSIONID=zdbk") || !has("route=r1"))
        return redirect("https://zjuam.zju.edu.cn/cas/login");
      return Response.json({
        items: [
          {
            xkkh: "(2026-2027-1)-CS101-0001",
            kcmc: "数据结构",
            kssj: "2027年01月12日(08:00-10:00)",
            jsmc: "西1-202",
            zwxh: "23",
          },
          {
            xkkh: "(2026-2027-1)-PH201-0002",
            kcmc: "大学物理",
            kssj: "考试周第3天(14:00-16:00)",
          },
        ],
      });
    }
    if (route.startsWith("courses.zju.edu.cn/api/activities/")) {
      if (!has("session=S1")) return new Response("", { status: 401 });
      const id = url.pathname.split("/").pop()!;
      state.activityCalls.push(id);
      if (options.brokenActivities?.includes(Number(id)))
        return new Response("oops", { status: 500 });
      return Response.json({
        id: Number(id),
        data: { description: `<p>作业 ${id} 的说明</p>` },
        uploads: [{ name: `附件${id}.pdf` }],
      });
    }
    if (route === "courses.zju.edu.cn/api/todos") {
      if (!has("session=S1")) return new Response("", { status: 401 });
      return Response.json({ todo_list: state.todos });
    }
    return new Response("not found", { status: 404 });
  };

  return { fetchImpl, state };
}

describe("sync", () => {
  const now = new Date("2026-11-10T01:00:00Z");
  const credentials = { username: "3200100001", password: "correct horse" };
  const todo = (id: number, title: string) => ({
    id,
    title,
    course_name: "数据结构",
    course_id: 778,
    type: "homework",
    end_time: "2026-11-20T15:59:00Z",
    is_student: true,
  });

  test("stores dated classes and coursework end to end", async () => {
    const zju = fakeZju({
      password: "correct horse",
      todos: [todo(1, "实验三"), todo(2, "实验四")],
    });
    const db = openDatabase(":memory:");

    const result = await runSync(db, credentials, {
      fetchImpl: zju.fetchImpl,
      now,
    });
    expect(result).toEqual({
      timetable: { ok: true, count: 15 },
      // The exam still listed as "考试周第3天" has no date and is not stored.
      exams: { ok: true, count: 1 },
      assignments: { ok: true, count: 2 },
    });
    expect(
      db
        .query(
          "SELECT title, location, notes, starts_at, ends_at FROM events WHERE source = 'exam'",
        )
        .all(),
    ).toEqual([
      {
        title: "期末考试：数据结构",
        location: "西1-202",
        notes: "座位号：23",
        starts_at: "2027-01-12T08:00:00+08:00",
        ends_at: "2027-01-12T10:00:00+08:00",
      },
    ]);
    expect(listAssignments(db)[0]).toMatchObject({
      title: "实验三",
      kind: "homework",
      url: "https://courses.zju.edu.cn/course/778/learning-activity#/1",
      description: "作业 1 的说明",
      attachments: ["附件1.pdf"],
    });

    const classes = db
      .query(
        "SELECT title, location, notes, starts_at, ends_at FROM events WHERE source = 'zdbk' ORDER BY starts_at",
      )
      .all() as Record<string, string>[];
    expect(classes).toHaveLength(15); // Mondays of both halves, minus the 10-05 holiday
    expect(classes[0]).toEqual({
      title: "数据结构",
      location: "紫金港东1-101",
      notes: "教师：张三",
      starts_at: "2026-09-14T08:00:00+08:00",
      ends_at: "2026-09-14T09:35:00+08:00",
    });
    expect(classes.at(-1)!.starts_at).toBe("2026-12-28T08:00:00+08:00");
    expect(
      listAssignments(db).map((a) => [a.title, a.status, a.dueAt]),
    ).toEqual([
      ["实验三", "open", "2026-11-20T15:59:00.000Z"],
      ["实验四", "open", "2026-11-20T15:59:00.000Z"],
    ]);

    // A second sync replaces classes instead of duplicating, and closes a submitted item.
    zju.state.todos = [todo(2, "实验四")];
    await runSync(db, credentials, { fetchImpl: zju.fetchImpl, now });
    expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 16,
    });
    // Details already fetched are not requested again.
    expect(zju.state.activityCalls).toEqual(["1", "2"]);
    expect(listAssignments(db).map((a) => [a.title, a.status])).toEqual([
      ["实验四", "open"],
      ["实验三", "done"],
    ]);

    const logs = db
      .query("SELECT source, ok, item_count FROM sync_log ORDER BY id")
      .all();
    expect(logs).toHaveLength(6);
    expect(logs.slice(0, 3)).toEqual([
      { source: "zdbk", ok: 1, item_count: 15 },
      { source: "exam", ok: 1, item_count: 1 },
      { source: "courses", ok: 1, item_count: 2 },
    ]);
  });

  test("details that cannot be fetched do not fail the sync and are retried", async () => {
    const zju = fakeZju({
      password: "correct horse",
      todos: [todo(1, "实验三"), todo(2, "实验四")],
      brokenActivities: [2],
    });
    const db = openDatabase(":memory:");

    const first = await runSync(db, credentials, {
      fetchImpl: zju.fetchImpl,
      now,
    });
    expect(first.assignments).toEqual({
      ok: true,
      count: 2,
      message: "有 1 项的作业详情没有取到",
    });
    expect(listAssignments(db).map((a) => a.description)).toEqual([
      "作业 1 的说明",
      null,
    ]);

    await runSync(db, credentials, { fetchImpl: zju.fetchImpl, now });
    // Only the one that failed is asked for again.
    expect(zju.state.activityCalls).toEqual(["1", "2", "2"]);
  });

  test("a wrong password fails both parts and stores nothing", async () => {
    const zju = fakeZju({
      password: "something else",
      todos: [todo(1, "实验三")],
    });
    const db = openDatabase(":memory:");
    db.exec(
      `INSERT INTO events (source, source_id, title, starts_at, ends_at)
       VALUES ('zdbk', 'old', '旧课', '2026-09-14T08:00:00+08:00', '2026-09-14T09:00:00+08:00')`,
    );

    const result = await runSync(db, credentials, {
      fetchImpl: zju.fetchImpl,
      now,
    });
    expect(result.timetable).toEqual({
      ok: false,
      message: "用户名或密码错误",
    });
    expect(result.exams).toEqual({ ok: false, message: "用户名或密码错误" });
    expect(result.assignments).toEqual({
      ok: false,
      message: "用户名或密码错误",
    });
    expect(zju.state.timetableCalls).toBe(0);
    // Classes from the last good sync are kept.
    expect(db.query("SELECT count(*) AS n FROM events").get()).toEqual({
      n: 1,
    });
    expect(db.query("SELECT count(*) AS n FROM assignments").get()).toEqual({
      n: 0,
    });
  });

  test("a captcha pauses the timetable and the answer resumes on the same session", async () => {
    const zju = fakeZju({
      password: "correct horse",
      captcha: "x7k2",
      todos: [todo(1, "实验三")],
    });
    const db = openDatabase(":memory:");

    const first = await runSync(db, credentials, {
      fetchImpl: zju.fetchImpl,
      now,
    });
    expect(first.timetable.ok).toBe(false);
    expect(first.captcha?.imageDataUrl).toBe("data:image/jpeg;base64,AQID");
    // Coursework does not depend on the captcha.
    expect(first.assignments).toEqual({ ok: true, count: 1 });
    // Nor do exams; only the timetable waits for the answer.
    expect(first.exams).toEqual({ ok: true, count: 1 });
    expect(
      db.query("SELECT count(*) AS n FROM events WHERE source = 'zdbk'").get(),
    ).toEqual({ n: 0 });

    const second = await runSync(db, credentials, {
      fetchImpl: zju.fetchImpl,
      now,
      captcha: "x7k2",
    });
    expect(second.timetable).toEqual({ ok: true, count: 15 });
    expect(second.captcha).toBeUndefined();
    expect(zju.state.loginAttempts).toBe(1);
  });

  test("the HTTP session refuses to follow a redirect off the ZJU domain", async () => {
    const session = new HttpSession(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/steal" },
        }),
    );
    expect(
      session.follow("https://courses.zju.edu.cn/user/index"),
    ).rejects.toThrow("校外地址");
  });
});
