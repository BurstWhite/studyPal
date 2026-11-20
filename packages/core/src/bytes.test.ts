import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { bytesToBase64, bytesToHex, sha1Hex } from "./bytes";

describe("byte helpers match Node's", () => {
  const samples = [
    "",
    "a",
    "abc",
    "日程：高等数学 第 3 周",
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(64),
    JSON.stringify({
      key: "event-1",
      title: "考试",
      alarms: [30, 1440],
    }).repeat(40),
  ];

  test("sha1Hex", () => {
    for (const text of samples) {
      expect(sha1Hex(text)).toBe(createHash("sha1").update(text).digest("hex"));
    }
  });

  test("bytesToHex and bytesToBase64", () => {
    for (const text of samples) {
      const bytes = new TextEncoder().encode(text);
      expect(bytesToHex(bytes)).toBe(Buffer.from(bytes).toString("hex"));
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });
});
