import { join } from "node:path";
import { readLiveSessions, type LiveSession } from "./live.ts";
import { readRateLimits, type RateLimitsView } from "./rate-limits.ts";
import { createTranscriptStore } from "./transcripts.ts";
import { createSystemProbe, type SystemView } from "./system.ts";
import { summarizeUsage, type UsageSummary } from "./usage.ts";

export type Board = {
  generatedAtMs: number;
  timeZone: string;
  rateLimits: RateLimitsView;
  usage: { status: "loading" } | { status: "ready"; summary: UsageSummary };
  live: LiveSession[];
  system: SystemView;
};

export type BoardConfig = {
  claudeDir: string;
  rateLimitsFile: string;
  timeZone: string;
};

const dayMs = 86_400_000;
const shownDays = 14;

export function createBoard(config: BoardConfig): { snapshot(nowMs: number): Promise<Board> } {
  const systemProbe = createSystemProbe();
  const store = createTranscriptStore({ projectsDir: join(config.claudeDir, "projects"), windowMs: (shownDays + 1) * dayMs });

  async function usage(nowMs: number): Promise<Board["usage"]> {
    if (!store.warm) {
      store.refresh(nowMs).catch(() => undefined);
      return { status: "loading" };
    }
    await store.refresh(nowMs);
    const summary = summarizeUsage(store.usageRecords(), {
      nowMs,
      timeZone: config.timeZone,
      days: shownDays,
      sessionWindowMs: dayMs,
      sessionLimit: 12,
      titleOf: store.sessionTitle,
    });
    return { status: "ready", summary };
  }

  return {
    async snapshot(nowMs) {
      const usageView = await usage(nowMs);
      const [rateLimits, live, system] = await Promise.all([
        readRateLimits(config.rateLimitsFile, nowMs),
        readLiveSessions({
          claudeDir: config.claudeDir,
          nowMs,
          finishedVisibleMs: 10 * 60_000,
          agentOutcome: store.warm ? store.agentOutcome : () => "unknown",
        }),
        systemProbe.sample(),
      ]);
      return { generatedAtMs: nowMs, timeZone: config.timeZone, rateLimits, usage: usageView, live, system };
    },
  };
}
