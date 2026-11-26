import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageRecord } from "../src/transcripts.ts";
import { summarizeUsage } from "../src/usage.ts";

const now = Date.parse("2026-11-26T03:00:00.000Z");
const hourMs = 3_600_000;
const none = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

function record(options: {
  messageId: string;
  sessionId?: string;
  at: string;
  model?: string;
  output: number;
  project?: string | null;
}): UsageRecord {
  return {
    messageId: options.messageId,
    sessionId: options.sessionId ?? "s1",
    timestampMs: Date.parse(options.at),
    project: options.project === undefined ? "sample-project" : options.project,
    billings: [{ model: options.model ?? "claude-opus-5-5", speed: "standard", tokens: { ...none, output: options.output } }],
  };
}

const options = { nowMs: now, timeZone: "Asia/Tokyo", days: 3, sessionWindowMs: 24 * hourMs, sessionLimit: 10, titleOf: () => undefined };

test("日ごとの集計は指定したタイムゾーンの日付で分け、記録の無い日も0で並べる", () => {
  const summary = summarizeUsage(
    [
      record({ messageId: "m1", at: "2026-11-25T14:59:00.000Z", output: 1_000_000 }),
      record({ messageId: "m2", at: "2026-11-25T15:00:00.000Z", output: 2_000_000 }),
    ],
    options,
  );
  assert.deepEqual(
    summary.days.map((day) => [day.date, day.totals.tokens.output, day.totals.costUsd]),
    [
      ["2026-11-24", 0, 0],
      ["2026-11-25", 1_000_000, 20],
      ["2026-11-26", 2_000_000, 40],
    ],
  );
});

test("単価を知らないモデルはトークンだけ足し、金額には入れずにモデル名を残す", () => {
  const summary = summarizeUsage(
    [
      record({ messageId: "m1", at: "2026-11-26T01:00:00.000Z", output: 1_000_000 }),
      record({ messageId: "m2", at: "2026-11-26T01:00:00.000Z", output: 5, model: "claude-unknown-9" }),
    ],
    options,
  );
  const today = summary.days.at(-1)?.totals;
  assert.equal(today?.tokens.output, 1_000_005);
  assert.equal(today?.costUsd, 20);
  assert.deepEqual(today?.unpricedModels, ["claude-unknown-9"]);
});

test("セッションごとの集計はサブエージェントの分も含め、最後に動いた順に並べる", () => {
  const summary = summarizeUsage(
    [
      record({ messageId: "m1", sessionId: "s1", at: "2026-11-26T01:00:00.000Z", output: 1_000_000 }),
      record({ messageId: "m2", sessionId: "s1", at: "2026-11-26T01:30:00.000Z", output: 1_000_000, project: null }),
      record({ messageId: "m3", sessionId: "s2", at: "2026-11-26T02:00:00.000Z", output: 1, project: "other" }),
      record({ messageId: "m4", sessionId: "s3", at: "2026-11-24T02:00:00.000Z", output: 1 }),
    ],
    { ...options, titleOf: (sessionId: string) => (sessionId === "s1" ? "a title" : undefined) },
  );
  assert.deepEqual(
    summary.sessions.map((session) => [session.sessionId, session.project, session.title, session.totals.costUsd]),
    [
      ["s2", "other", null, 0.00002],
      ["s1", "sample-project", "a title", 40],
    ],
  );
  assert.equal(summary.sessions[1]?.lastActivityMs, Date.parse("2026-11-26T01:30:00.000Z"));
});

test("セッションは上限の件数までにする", () => {
  const records = ["s1", "s2", "s3"].map((sessionId, index) =>
    record({ messageId: `m${index}`, sessionId, at: `2026-11-26T0${index}:00:00.000Z`, output: 1 }),
  );
  assert.deepEqual(
    summarizeUsage(records, { ...options, sessionLimit: 2 }).sessions.map((session) => session.sessionId),
    ["s3", "s2"],
  );
});
