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
    system: { memoryUsedPercentage: 54, cpuBusyPercentage: 30 },
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

test("5時間枠は残りの割合とリセットまでの時間だけを出し、取得から15分以内なら取得の時刻を出さない", () => {
  const html = renderPage(board({}));
  assert.match(html, /<strong>83<\/strong>/);
  assert.match(html, /あと 1:01/);
  assert.doesNotMatch(html, />[^<]*13:01/);
  assert.doesNotMatch(html, />[^<]*取得/);
  assert.doesNotMatch(html, />[^<]*\d+:\d+ 更新/);
});

test("取得から15分を過ぎた残りは、いつのデータかを出す", () => {
  const html = renderPage(
    board({
      rateLimits: {
        status: "available",
        capturedAtMs: now - 20 * minuteMs,
        fiveHour: { state: "active", usedPercentage: 17, resetsAtMs: now + 61 * minuteMs },
        sevenDay: { state: "absent" },
      },
    }),
  );
  assert.match(html, /20分前のデータ/);
});

test("リセット時刻を過ぎた枠は使用率を出さずにリセット済みと出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /リセット済み/);
});

test("制限が取得できないときは理由を出し、数字を出さない", () => {
  const html = renderPage(board({ rateLimits: { status: "unavailable", reason: "statusline のファイルが無い" } }));
  assert.match(html, /取得できません/);
  assert.match(html, /statusline のファイルが無い/);
  assert.doesNotMatch(html, /<strong>\d+<\/strong><span class="pct">/);
});

test("今日の金額を出し、日ごとの金額と単価不明のモデルは触れたときだけ出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /<strong>\$40\.00\+<\/strong>/);
  assert.match(html, /title="[^"]*\$12\.50/);
  assert.match(html, /title="[^"]*単価不明: claude-unknown-9/);
  assert.doesNotMatch(html, /1\.5M/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /日間で/);
  assert.doesNotMatch(html, />[^<]*推定額/);
});

test("集計中は使用量の代わりに集計中と出す", () => {
  const html = renderPage(board({ usage: { status: "loading" } }));
  assert.match(html, /集計中/);
});

test("セッションの名前や待っている内容は HTML として解釈させない", () => {
  const base = board({});
  const [session] = base.live;
  assert.ok(session !== undefined);
  const html = renderPage({ ...base, live: [{ ...session, name: "<script>alert(1)</script>" }] });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("入力待ちのセッションは名前と待っている内容を出し、実行中は件数だけを出す", () => {
  const base = board({});
  const [session] = base.live;
  assert.ok(session !== undefined);
  const html = renderPage({
    ...base,
    live: [
      session,
      { ...session, pid: 2, sessionId: "s2", name: "busy-session", status: "busy", waitingFor: null },
      { ...session, pid: 3, sessionId: "s3", name: "resting-session", status: "idle", waitingFor: null },
    ],
  });
  assert.match(html, /sample-session/);
  assert.match(html, /input needed/);
  assert.match(html, /<strong>1<\/strong>\s*<span[^>]*>実行中/);
  assert.doesNotMatch(html, /busy-session/);
  assert.doesNotMatch(html, /resting-session/);
  assert.doesNotMatch(html, /worker-one|サブエージェント|分前|ほか/);
});

test("時計と、Mac のメモリと CPU の使用率を出す", () => {
  const html = renderPage(board({}));
  assert.match(html, /<time[^>]*>12:00<\/time>/);
  assert.match(html, /メモリ[\s\S]*?54%/);
  assert.match(html, /CPU[\s\S]*?30%/);
});

test("メモリと CPU が取れないときは値の代わりに - を出す", () => {
  const html = renderPage(board({ system: { memoryUsedPercentage: null, cpuBusyPercentage: null } }));
  assert.match(html, /メモリ[\s\S]*?<strong>-<\/strong>/);
});
