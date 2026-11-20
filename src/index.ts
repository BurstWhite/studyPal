import { serve } from "bun";
import index from "./index.html";
import { getDb } from "@studypal/core/db";
import { warmModelLists } from "@studypal/core/llm/models";
import { assignmentRoutes } from "@studypal/core/routes/assignments";
import { chatRoutes } from "@studypal/core/routes/chat";
import { eventRoutes } from "@studypal/core/routes/events";
import { studyRoutes } from "@studypal/core/routes/study";
import { systemRoutes } from "@studypal/core/routes/system";
import { syncNow, zjuRoutes } from "@studypal/core/routes/zju";
import { guardAll, handleAuth } from "./server/auth";
import { config } from "./server/config";
import { useDesktopPlatform } from "./server/platform";
import { usageRoutes } from "./server/routes/usage";

useDesktopPlatform();

// Open (and migrate) the database before accepting requests.
getDb();

const server = serve({
  hostname: "127.0.0.1",
  port: config.port,

  routes: {
    "/auth": { GET: (req) => handleAuth(req) },
    ...guardAll(systemRoutes),
    ...guardAll(eventRoutes),
    ...guardAll(assignmentRoutes),
    ...guardAll(zjuRoutes),
    ...guardAll(chatRoutes),
    ...guardAll(studyRoutes),
    ...usageRoutes,
    "/api/*": () => Response.json({ error: "not found" }, { status: 404 }),

    // The React app handles every other path.
    "/*": index,
  },

  development: !config.isProduction && {
    hmr: true,
    console: true,
  },
});

// When launched by the desktop shell, stop as soon as the shell is gone so a
// crashed app never leaves an orphaned server holding the port.
if (config.parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(config.parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}

// Sync with ZJU at startup and every two hours (a no-op until an account is
// saved). Deadline reminders need no background work here: they are alarms in
// the system calendar.
const SYNC_INTERVAL_MS = 2 * 60 * 60_000;
const sync = () =>
  syncNow().catch((error) => console.error("sync failed:", error));

if (process.env.STUDYPAL_NO_BACKGROUND !== "1") {
  setInterval(() => void sync(), SYNC_INTERVAL_MS).unref();
  void sync();
  // Ask each model service which models it offers, so the chat's model
  // picker is filled before it is first opened.
  warmModelLists(getDb());
}

console.log(`studyPal server listening on ${server.url}`);
