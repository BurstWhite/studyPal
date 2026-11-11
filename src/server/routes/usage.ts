import { guarded } from "../auth";
import {
  BridgeError,
  bridgeStatus,
  installBridge,
  previewInstall,
  readClaudeLimits,
  uninstallBridge,
  type BridgeStatus,
} from "../usage/bridge";
import {
  readClaudeUsage,
  readCodexUsage,
  type Limits,
  type TokenWindows,
} from "../usage/logs";

export interface UsageReport {
  claude: {
    /** False when Claude Code has left no logs on this machine. */
    found: boolean;
    tokens: TokenWindows;
    /** Null until the status line bridge is enabled and has captured data. */
    limits: Limits | null;
    bridge: BridgeStatus;
  };
  codex: { found: boolean; tokens: TokenWindows; limits: Limits | null };
}

export async function readUsage(now = new Date()): Promise<UsageReport> {
  const [claude, codex, limits, bridge] = await Promise.all([
    readClaudeUsage(now),
    readCodexUsage(now),
    readClaudeLimits(now),
    bridgeStatus(),
  ]);
  return { claude: { ...claude, limits, bridge }, codex };
}

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    { error: message },
    { status: error instanceof BridgeError ? 409 : 500 },
  );
}

export const usageRoutes = {
  "/api/usage": {
    GET: guarded(async () => Response.json(await readUsage())),
  },

  /** What enabling the Claude rate-limit display would change; changes nothing. */
  "/api/usage/claude-bridge/preview": {
    GET: guarded(async () => {
      try {
        return Response.json(await previewInstall());
      } catch (error) {
        return failure(error);
      }
    }),
  },

  /**
   * Enabling edits Claude Code's settings file, so it must be an explicit,
   * confirmed request: the body has to carry `{ "consent": true }`.
   */
  "/api/usage/claude-bridge": {
    POST: guarded(async (req: Request) => {
      const body = (await req.json().catch(() => null)) as {
        consent?: unknown;
      } | null;
      if (body?.consent !== true) {
        return Response.json(
          { error: "需要明确同意才能修改 Claude Code 的设置" },
          { status: 400 },
        );
      }
      try {
        return Response.json({ backup: await installBridge() });
      } catch (error) {
        return failure(error);
      }
    }),
    DELETE: guarded(async () => {
      try {
        await uninstallBridge();
        return Response.json({ ok: true });
      } catch (error) {
        return failure(error);
      }
    }),
  },
};
