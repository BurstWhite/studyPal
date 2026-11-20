import { expect, test } from "bun:test";
import { parseBlocks } from "./markdownBlocks";

test("splits a typical reply into blocks", () => {
  const reply = [
    "## 本周安排",
    "",
    "我帮你排了三个学习块：",
    "- 周三 **19:00** 数据结构",
    "- 周四 20:00 线代",
    "  第二行续写",
    "",
    "1. 先做实验",
    "2. 再复习",
    "",
    "| 时间 | 内容 |",
    "|---|---|",
    "| 19:00 | 实验 |",
    "",
    "```",
    "code here",
    "```",
    "> 提示",
  ].join("\n");
  expect(parseBlocks(reply)).toEqual([
    { kind: "heading", level: 2, text: "本周安排" },
    { kind: "paragraph", text: "我帮你排了三个学习块：" },
    {
      kind: "list",
      ordered: false,
      items: ["周三 **19:00** 数据结构", "周四 20:00 线代 第二行续写"],
    },
    { kind: "list", ordered: true, items: ["先做实验", "再复习"] },
    {
      kind: "table",
      rows: [
        ["时间", "内容"],
        ["19:00", "实验"],
      ],
    },
    { kind: "code", text: "code here" },
    { kind: "quote", text: "提示" },
  ]);
});
