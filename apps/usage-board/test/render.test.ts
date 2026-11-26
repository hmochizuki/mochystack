import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board } from "../src/board.ts";
import { renderPage } from "../src/render.ts";
import type { UsageTotals } from "../src/usage.ts";

const now = Date.parse("2026-11-26T03:00:00.000Z");
const minuteMs = 60_000;

function totals(costUsd: number, unpricedModels: string[] = []): UsageTotals {
  return { tokens: { input: 1000, output: 2000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1_500_000 }, costUsd, unpricedModels };
}

function board(overrides: Partial<Board>): Board {
  return {
    generatedAtMs: now,
    timeZone: "Asia/Tokyo",
    rateLimits: {
      status: "available",
      capturedAtMs: now - 3 * minuteMs,
      fiveHour: { state: "active", usedPercentage: 17, resetsAtMs: now + 61 * minuteMs },
      sevenDay: { state: "reset", resetsAtMs: now - minuteMs },
    },
    usage: {
      status: "ready",
      summary: {
        days: [
          { date: "2026-11-25", totals: totals(12.5) },
          { date: "2026-11-26", totals: totals(40, ["claude-unknown-9"]) },
        ],
        sessions: [
          {
            sessionId: "s1",
            project: "sample-project",
            title: "<script>alert(1)</script>",
            lastActivityMs: now - 5 * minuteMs,
            totals: totals(3.25),
          },
        ],
      },
    },
    live: [
      {
        pid: 1,
        sessionId: "s1",
        name: "sample-session",
        project: "sample-project",
        status: "waiting",
        waitingFor: "input needed",
        startedAtMs: now - 60 * minuteMs,
        statusUpdatedAtMs: now - 2 * minuteMs,
        subagents: [
          {
            agentId: "a1",
            label: "worker-one",
            agentType: "general-purpose",
            model: "opus",
            state: "running",
            lastWriteMs: now - 20_000,
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("5時間枠は残りの割合、リセットまでの時間、リセットの時刻を出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /残り\s*<strong[^>]*>83%<\/strong>/);
  assert.match(html, /リセットまで 1時間1分/);
  assert.match(html, /13:01/);
  assert.match(html, /3分前に取得/);
});

test("リセット時刻を過ぎた枠は使用率を出さずにリセット済みと出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /リセット済み/);
});

test("制限が取得できないときは理由を出し、数字を出さない", () => {
  const html = renderPage(board({ rateLimits: { status: "unavailable", reason: "statusline のファイルが無い" } }));
  assert.match(html, /取得できません/);
  assert.match(html, /statusline のファイルが無い/);
  assert.doesNotMatch(html, /残り\s*<strong/);
});

test("日ごとの金額とトークン、単価不明のモデルを出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /\$40\.00/);
  assert.match(html, /\$12\.50/);
  assert.match(html, /1\.5M/);
  assert.match(html, /単価不明: claude-unknown-9/);
});

test("集計中は使用量の代わりに集計中と出す", () => {
  const html = renderPage(board({ usage: { status: "loading" } }));
  assert.match(html, /集計中/);
});

test("セッションの題名などは HTML として解釈させない", () => {
  const html = renderPage(board({}));
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("動いているセッションは状態、待っている内容、サブエージェントの状態を出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /入力待ち/);
  assert.match(html, /input needed/);
  assert.match(html, /worker-one/);
  assert.match(html, /実行中/);
  assert.match(html, /20秒前/);
});
