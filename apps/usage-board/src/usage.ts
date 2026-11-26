import { costUsd, type TokenCounts } from "./pricing.ts";
import type { UsageRecord } from "./transcripts.ts";

export type UsageTotals = {
  tokens: TokenCounts;
  costUsd: number;
  unpricedModels: string[];
};

export type DayUsage = { date: string; totals: UsageTotals };

export type SessionUsage = {
  sessionId: string;
  project: string | null;
  title: string | null;
  lastActivityMs: number;
  totals: UsageTotals;
};

export type UsageSummary = { days: DayUsage[]; sessions: SessionUsage[] };

export type SummaryOptions = {
  nowMs: number;
  timeZone: string;
  days: number;
  sessionWindowMs: number;
  sessionLimit: number;
  titleOf: (sessionId: string) => string | undefined;
};

function emptyTotals(): UsageTotals {
  return { tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, costUsd: 0, unpricedModels: [] };
}

function add(totals: UsageTotals, record: UsageRecord): void {
  for (const billing of record.billings) {
    totals.tokens.input += billing.tokens.input;
    totals.tokens.output += billing.tokens.output;
    totals.tokens.cacheWrite5m += billing.tokens.cacheWrite5m;
    totals.tokens.cacheWrite1h += billing.tokens.cacheWrite1h;
    totals.tokens.cacheRead += billing.tokens.cacheRead;
    const cost = costUsd(billing);
    if (cost !== null) totals.costUsd += cost;
    else if (!totals.unpricedModels.includes(billing.model)) totals.unpricedModels.push(billing.model);
  }
}

function previousDates(today: string, count: number): string[] {
  const [year, month, day] = today.split("-").map(Number);
  const todayUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(todayUtc - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

export function summarizeUsage(records: Iterable<UsageRecord>, options: SummaryOptions): UsageSummary {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map(previousDates(dateKey.format(options.nowMs), options.days).map((date) => [date, emptyTotals()]));
  const sessions = new Map<string, SessionUsage>();
  for (const record of records) {
    const day = days.get(dateKey.format(record.timestampMs));
    if (day !== undefined) add(day, record);
    const session = sessions.get(record.sessionId) ?? {
      sessionId: record.sessionId,
      project: null,
      title: options.titleOf(record.sessionId) ?? null,
      lastActivityMs: 0,
      totals: emptyTotals(),
    };
    sessions.set(record.sessionId, session);
    session.project ??= record.project;
    session.lastActivityMs = Math.max(session.lastActivityMs, record.timestampMs);
    add(session.totals, record);
  }
  return {
    days: [...days].map(([date, totals]) => ({ date, totals })),
    sessions: [...sessions.values()]
      .filter((session) => session.lastActivityMs >= options.nowMs - options.sessionWindowMs)
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .slice(0, options.sessionLimit),
  };
}
