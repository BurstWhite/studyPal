/**
 * Connects the shared code to the phone: platform services for
 * `@studypal/core`, and an in-process transport for `@studypal/client` that
 * hands API requests straight to the route handlers instead of a server.
 */
import "./polyfills";
import { setTransport } from "@studypal/client/transport";
import { setChatOpener } from "@studypal/client/chat/pendingPrompt";
import { getDb } from "@studypal/core/db";
import { configurePlatform } from "@studypal/core/platform";
import { createRouter } from "@studypal/core/router";
import { assignmentRoutes } from "@studypal/core/routes/assignments";
import { chatRoutes } from "@studypal/core/routes/chat";
import { eventRoutes } from "@studypal/core/routes/events";
import { studyRoutes } from "@studypal/core/routes/study";
import { systemRoutes } from "@studypal/core/routes/system";
import { zjuRoutes } from "@studypal/core/routes/zju";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import Constants from "expo-constants";
import { runCalendar } from "./calendar";
import { openAppDatabase } from "./db";
import { zjuFetch } from "./http";
import { secretStore } from "./secrets";

/** Requests never leave the app, so the host is only a placeholder. */
const ORIGIN = "http://studypal.local";

let ready = false;

export function setUpPlatform(): void {
  if (ready) return;
  ready = true;

  configurePlatform({
    openDb: openAppDatabase,
    secrets: secretStore,
    calendar: runCalendar,
    zjuFetch,
    openUrl: async (url) => {
      await WebBrowser.openBrowserAsync(url);
    },
    builtAt: Constants.expoConfig?.version ?? "",
    version: Constants.expoConfig?.version ?? "",
  });

  const route = createRouter({
    ...systemRoutes,
    ...eventRoutes,
    ...assignmentRoutes,
    ...zjuRoutes,
    ...chatRoutes,
    ...studyRoutes,
  });
  setTransport((path, init) => route(new Request(ORIGIN + path, init)));
  setChatOpener(() => router.navigate("/chat"));

  // Open and migrate the database before the first screen asks for data.
  getDb();
}
