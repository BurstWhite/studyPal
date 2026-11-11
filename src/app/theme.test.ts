import { expect, test } from "bun:test";
import { parseTheme, resolvesToDark } from "./theme";

test("anything other than an explicit choice means follow the system", () => {
  expect(parseTheme(null)).toBe("system");
  expect(parseTheme("")).toBe("system");
  expect(parseTheme("blue")).toBe("system");
  expect(parseTheme("light")).toBe("light");
  expect(parseTheme("dark")).toBe("dark");
});

test("an explicit choice wins over the system; otherwise the system decides", () => {
  expect(resolvesToDark("system", true)).toBe(true);
  expect(resolvesToDark("system", false)).toBe(false);
  expect(resolvesToDark("dark", false)).toBe(true);
  expect(resolvesToDark("light", true)).toBe(false);
});
