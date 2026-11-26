import { join } from "node:path";
import type { BoardConfig } from "./board.ts";

export type Config = {
  board: BoardConfig;
  host: string;
  port: number;
  allowedHosts: string[];
};

function port(value: string | undefined): number {
  if (value === undefined) return 4317;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`USAGE_BOARD_PORT が 0〜65535 の整数ではない: ${value}`);
  }
  return parsed;
}

export function configFromEnv(env: Record<string, string | undefined>, home: string): Config {
  return {
    board: {
      claudeDir: env["CLAUDE_CONFIG_DIR"] ?? join(home, ".claude"),
      rateLimitsFile: env["USAGE_BOARD_RATE_LIMITS_FILE"] ?? join(home, "claude-queue", "usage.json"),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    host: env["USAGE_BOARD_HOST"] ?? "127.0.0.1",
    port: port(env["USAGE_BOARD_PORT"]),
    allowedHosts: (env["USAGE_BOARD_ALLOWED_HOSTS"] ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter((host) => host !== ""),
  };
}
