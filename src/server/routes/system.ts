import type { Database } from "bun:sqlite";
import { guarded } from "../auth";
import { getDb } from "../db";

export interface Overview {
  events: number;
  openAssignments: number;
  studyBlocks: number;
  studyBlocksDone: number;
  providers: number;
}

export function readOverview(db: Database): Overview {
  const count = (sql: string) => (db.query(sql).get() as { n: number }).n;
  return {
    events: count("SELECT count(*) AS n FROM events"),
    openAssignments: count(
      "SELECT count(*) AS n FROM assignments WHERE status = 'open'",
    ),
    studyBlocks: count("SELECT count(*) AS n FROM study_blocks"),
    studyBlocksDone: count(
      "SELECT count(*) AS n FROM study_blocks WHERE done = 1",
    ),
    providers: count("SELECT count(*) AS n FROM providers"),
  };
}

export const systemRoutes = {
  /** Unauthenticated liveness probe used by the desktop shell at startup. */
  "/api/health": {
    GET: () => Response.json({ ok: true, app: "studypal" }),
  },
  "/api/overview": {
    GET: guarded(() => Response.json(readOverview(getDb()))),
  },
};
