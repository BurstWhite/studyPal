import { expect, test } from "bun:test";
import { splitSetCookie } from "./cookies";

test("splits headers iOS joined, keeping Expires dates whole", () => {
  // As captured from expo/fetch on the simulator during the spike.
  expect(
    splitSetCookie(
      "spikeA=1; Path=/, spikeB=2; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT, spikeC=3; Path=/; HttpOnly, spikeD=; Max-Age=0; Path=/",
    ),
  ).toEqual([
    "spikeA=1; Path=/",
    "spikeB=2; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT",
    "spikeC=3; Path=/; HttpOnly",
    "spikeD=; Max-Age=0; Path=/",
  ]);
});

test("the real ZJU login page's cookies", () => {
  expect(
    splitSetCookie(
      "JSESSIONID=abc123; Path=/cas; HttpOnly, _csrf=xyz%3D%3D; Domain=zju.edu.cn; Path=/",
    ),
  ).toEqual([
    "JSESSIONID=abc123; Path=/cas; HttpOnly",
    "_csrf=xyz%3D%3D; Domain=zju.edu.cn; Path=/",
  ]);
  expect(splitSetCookie("")).toEqual([]);
});
