import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Board } from "../src/board.ts";
import { isObject, numberAt } from "../src/json.ts";
import { startServer } from "../src/server.ts";
import type { UsageTotals } from "../src/usage.ts";
import { chromePath, evaluate, launchChrome, waitUntilTrue, type Cdp, type Chrome } from "./chrome.ts";
import { tempDir } from "./fixtures.ts";

const bundledUiFile = fileURLToPath(new URL("../public/board.html", import.meta.url));
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
            title: "sample title",
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

function crowdedBoard(nowMs: number): Board {
  const dayTotals = totals(1.5);
  return {
    generatedAtMs: nowMs,
    timeZone: "Asia/Tokyo",
    system: { memoryUsedPercentage: 40, cpuBusyPercentage: 10 },
    rateLimits: {
      status: "available",
      capturedAtMs: nowMs,
      fiveHour: { state: "active", usedPercentage: 100, resetsAtMs: nowMs + 299 * minuteMs },
      sevenDay: { state: "active", usedPercentage: 3, resetsAtMs: nowMs + 6 * 24 * 60 * minuteMs },
    },
    usage: {
      status: "ready",
      summary: {
        days: Array.from({ length: 14 }, (_, index) => ({ date: `2026-11-${index + 10}`, totals: dayTotals })),
        sessions: [],
      },
    },
    live: Array.from({ length: 40 }, (_, index) => ({
      pid: index + 1,
      sessionId: `session-${index}`,
      name: `sample session ${index}`,
      project: "sample-project",
      status: "waiting",
      waitingFor: `permission needed ${index}`,
      startedAtMs: nowMs - 60 * minuteMs,
      statusUpdatedAtMs: nowMs - minuteMs,
      subagents: [],
    })),
  };
}

const testHooks = `(() => {
  const params = new URLSearchParams(location.search);
  const intervalMs = params.get("intervalMs");
  if (intervalMs !== null) {
    const original = window.setInterval;
    window.setInterval = (handler, _timeout, ...args) => original(handler, Number(intervalMs), ...args);
  }
  const fetchTimeoutMs = params.get("fetchTimeoutMs");
  if (fetchTimeoutMs !== null) {
    const original = AbortSignal.timeout;
    AbortSignal.timeout = () => original.call(AbortSignal, Number(fetchTimeoutMs));
  }
})();`;

type Viewport = { width: number; height: number; mobile: boolean };
const tablet: Viewport = { width: 1180, height: 820, mobile: false };
const phoneLandscape: Viewport = { width: 667, height: 375, mobile: true };

type Source = (nowMs: number) => Promise<Board>;

async function serve(uiFile: string, snapshot: Source): Promise<{ url: string; close(): Promise<void> }> {
  const server = await startServer({ board: { snapshot }, uiFile, host: "127.0.0.1", port: 0, allowedHosts: [] });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

describe("画面", { skip: chromePath === undefined && "Chrome が見つからない" }, () => {
  let chrome: Chrome;
  let cdp: Cdp;
  let source: Source = async () => board({});
  let server: { url: string; close(): Promise<void> };
  let visits = 0;

  before(async () => {
    assert.ok(chromePath !== undefined);
    server = await serve(bundledUiFile, (nowMs) => source(nowMs));
    chrome = await launchChrome(chromePath);
    cdp = chrome.cdp;
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: testHooks });
  });

  after(async () => {
    try {
      await chrome.close();
    } finally {
      await server.close();
    }
  });

  async function visit(options: { baseUrl?: string; query?: string; viewport?: Viewport } = {}): Promise<void> {
    const viewport = options.viewport ?? tablet;
    visits += 1;
    const url = `${options.baseUrl ?? server.url}?visit=${visits}${options.query === undefined ? "" : `&${options.query}`}`;
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      mobile: viewport.mobile,
    });
    await cdp.send("Page.navigate", { url });
    await waitUntilTrue(cdp, `location.href === ${JSON.stringify(url)} && document.readyState === "complete"`);
  }

  async function show(next: Board, options: { query?: string; viewport?: Viewport } = {}): Promise<void> {
    source = async () => next;
    await visit(options);
    await waitUntilTrue(cdp, `document.body.dataset.offline === "false"`);
  }

  async function text(selector: string): Promise<string> {
    const value = await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    assert.ok(typeof value === "string", `${selector} が無い`);
    return value;
  }

  async function count(selector: string): Promise<number> {
    const value = await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
    assert.ok(typeof value === "number");
    return value;
  }

  test("5時間枠は残りの割合とリセットまでの時間だけを出し、取得から15分以内なら取得の時刻を出さない", async () => {
    await show(board({}));
    assert.equal(await text(".dial .reading strong"), "83");
    assert.equal(await evaluate(cdp, `document.querySelector(".dial [role=meter]").getAttribute("aria-valuenow")`), "83");
    const main = await text("main");
    assert.match(main, /あと 1:01/);
    assert.doesNotMatch(main, /13:01/);
    assert.doesNotMatch(main, /取得/);
    assert.doesNotMatch(main, /\d+:\d+ 更新/);
    assert.equal(await evaluate(cdp, `document.querySelector(".dial").title`), "11/26 13:01 にリセット");
  });

  test("取得から15分を過ぎた残りは、いつのデータかを出す", async () => {
    await show(
      board({
        rateLimits: {
          status: "available",
          capturedAtMs: now - 20 * minuteMs,
          fiveHour: { state: "active", usedPercentage: 17, resetsAtMs: now + 61 * minuteMs },
          sevenDay: { state: "absent" },
        },
      }),
    );
    assert.equal(await text("[data-stale=true]"), "20分前のデータ");
    assert.match(await text("main"), /値なし/);
  });

  test("リセット時刻を過ぎた枠は使用率を出さずにリセット済みと出す", async () => {
    await show(board({}));
    assert.match(await text("main"), /リセット済み/);
    assert.equal(await count(".dial .reading strong"), 1);
  });

  test("制限が取得できないときは理由を出し、数字を出さない", async () => {
    await show(board({ rateLimits: { status: "unavailable", reason: "statusline のファイルが無い" } }));
    assert.equal(await text(".unavailable .lead"), "残りを取得できません");
    assert.equal(await text(".unavailable .note"), "statusline のファイルが無い");
    assert.equal(await count(".dial"), 0);
  });

  test("今日の金額と単価不明のモデルを出し、日ごとの金額は棒の title にだけ入れる", async () => {
    await show(board({}));
    assert.equal(await text(".figure strong"), "$40.00+");
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll(".spark li")].map((bar) => bar.title)`), [
      "11/25（水） $12.50",
      "11/26（木） $40.00+",
    ]);
    assert.equal(await count(".spark li[data-today=true]"), 1);
    assert.equal(await text(".usage .note"), "単価不明: claude-unknown-9（金額に含めていない）");
    const main = await text("main");
    assert.doesNotMatch(main, /1\.5M|日間で|推定額|\$12\.50/);
    assert.equal(await count("main table"), 0);
  });

  test("集計中は使用量の代わりに集計中と出す", async () => {
    await show(board({ usage: { status: "loading" } }));
    assert.equal(await text(".figure strong"), "集計中");
  });

  test("入力待ちのセッションは名前と待っている内容を出し、実行中は件数だけを出す", async () => {
    const base = board({});
    const [session] = base.live;
    assert.ok(session !== undefined);
    await show({
      ...base,
      live: [
        session,
        { ...session, pid: 2, sessionId: "s2", name: "busy-session", status: "busy", waitingFor: null },
        { ...session, pid: 3, sessionId: "s3", name: null, project: null, status: "waiting", waitingFor: null },
        { ...session, pid: 4, sessionId: "s4", name: "resting-session", status: "idle", waitingFor: null },
      ],
    });
    assert.equal(await text(".busy"), "1 実行中");
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll(".sessions > li")].map((row) => row.textContent)`), [
      "sample-sessioninput needed",
      "s3",
    ]);
    assert.doesNotMatch(await text("main"), /busy-session|resting-session|worker-one|サブエージェント|分前|ほか/);
  });

  test("時計と、Mac のメモリと CPU の使用率を出す", async () => {
    await show(board({}));
    assert.equal(await text("#clock"), "12:00");
    assert.equal(await text(".clock .date"), "11/26(木)");
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll(".meter")].map((meter) => meter.textContent)`), ["メモリ54%", "CPU30%"]);
  });

  test("メモリと CPU が取れないときは値の代わりに - を出す", async () => {
    await show(board({ system: { memoryUsedPercentage: null, cpuBusyPercentage: null } }));
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll(".meter strong")].map((value) => value.textContent)`), ["-", "-"]);
  });

  test("セッションの名前、待っている内容、単価不明のモデル名、取れない理由は HTML として解釈させない", async () => {
    const payload = `<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>`;
    const base = board({});
    const [session] = base.live;
    assert.ok(session !== undefined);
    for (const next of [
      {
        ...base,
        live: [{ ...session, name: payload, waitingFor: payload }],
        usage: { status: "ready" as const, summary: { days: [{ date: "2026-11-26", totals: totals(1, [payload]) }], sessions: [] } },
      },
      { ...base, rateLimits: { status: "unavailable" as const, reason: payload } },
    ]) {
      await show(next);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(await count("main img, main script"), 0);
      assert.equal(await evaluate(cdp, `window.pwned ?? null`), null);
      assert.ok((await text("main")).includes(payload));
    }
  });

  test("定期的に /api/board を読み直して描き直し、そのあいだ画面を読み込み直さない", async () => {
    await show(board({}), { query: "intervalMs=200" });
    await evaluate(cdp, `window.reloadProbe = "kept"`);
    source = async () => board({ usage: { status: "ready", summary: { days: [{ date: "2026-11-26", totals: totals(7) }], sessions: [] } } });
    await waitUntilTrue(cdp, `document.querySelector(".figure strong").textContent === "$7.00"`);
    assert.equal(await evaluate(cdp, `window.reloadProbe`), "kept");
  });

  test("/api/board が読めないあいだは、最後の表示を残して更新できませんと出し、読めたら消す", async () => {
    await show(board({}), { query: "intervalMs=200" });
    source = async () => {
      throw new Error("down");
    };
    await waitUntilTrue(cdp, `document.body.dataset.offline === "true"`);
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(".limits"), "::after").content`), `"更新できません"`);
    assert.equal(await count(".dial"), 2);
    source = async () => board({});
    await waitUntilTrue(cdp, `document.body.dataset.offline === "false"`);
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(".limits"), "::after").content`), "none");
  });

  test("/api/board が応答を返さないときも、待ちきれなければ更新できませんと出す", async () => {
    await show(board({}), { query: "intervalMs=200&fetchTimeoutMs=300" });
    source = () => new Promise(() => {});
    await waitUntilTrue(cdp, `document.body.dataset.offline === "true"`);
  });

  test("開いた時点で /api/board が読めなくても、更新できませんと出す", async () => {
    source = async () => {
      throw new Error("down");
    };
    await visit();
    await waitUntilTrue(cdp, `document.body.dataset.offline === "true"`);
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(".limits"), "::after").content`), `"更新できません"`);
  });

  test("時計は画面の中で進め、更新できないあいだも止めない", async () => {
    const twoHoursAgo = Date.now() - 120 * minuteMs;
    await show(board({ generatedAtMs: twoHoursAgo }), { query: "intervalMs=200" });
    source = async () => {
      throw new Error("down");
    };
    await waitUntilTrue(
      cdp,
      `document.body.dataset.offline === "true" && document.querySelector("#clock").textContent === new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.now())`,
    );
  });

  for (const viewport of [tablet, phoneLandscape]) {
    test(`${viewport.width}×${viewport.height} で描き直しても、入力待ちの一覧のスクロール位置を保つ`, async () => {
      let snapshots = 0;
      source = async (nowMs) => {
        snapshots += 1;
        return { ...crowdedBoard(nowMs), system: { memoryUsedPercentage: 40, cpuBusyPercentage: snapshots % 100 } };
      };
      await visit({ query: "intervalMs=200", viewport });
      await waitUntilTrue(cdp, `document.body.dataset.offline === "false"`);
      const before = await evaluate(
        cdp,
        `(() => {
          document.querySelector(".live").scrollTop = 120;
          return document.querySelectorAll(".meter strong")[1].textContent;
        })()`,
      );
      await waitUntilTrue(cdp, `document.querySelectorAll(".meter strong")[1].textContent !== ${JSON.stringify(before)}`);
      assert.equal(await evaluate(cdp, `document.querySelector(".live").scrollTop`), 120);
    });
  }

  test("iPhone SE の横向きで1画面に収まり、左の列の中身が列の外に出ない", async () => {
    await show(crowdedBoard(now), { viewport: phoneLandscape });
    const layout = await evaluate(
      cdp,
      `(() => {
        const limits = document.querySelector(".limits").getBoundingClientRect();
        const escaped = [...document.querySelectorAll(".limits *:not(svg *)")].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.right > limits.right + 0.5 || box.left < limits.left - 0.5 || box.bottom > limits.bottom + 0.5);
        }).length;
        const right = Math.max(...[...document.querySelectorAll(".dial, .figure")].map((element) => element.getBoundingClientRect().right));
        return { right, escaped, dials: document.querySelectorAll(".dial").length, overflowX: document.documentElement.scrollWidth - innerWidth, overflowY: document.documentElement.scrollHeight - innerHeight };
      })()`,
    );
    assert.ok(isObject(layout));
    assert.equal(numberAt(layout, "overflowX"), 0, "横にはみ出さない");
    assert.equal(numberAt(layout, "overflowY"), 0, "縦にはみ出さない");
    assert.equal(numberAt(layout, "dials"), 2);
    assert.equal(numberAt(layout, "escaped"), 0, "左の列の中身が列の外に出ない");
    const right = numberAt(layout, "right");
    assert.ok(right !== undefined && right <= 667, "計器と今日の金額が画面の中にある");
  });

  test("UI のファイルを書き換えると、開いている画面が自分で読み込み直す", async () => {
    const uiFile = join(await tempDir("ui"), "board.html");
    await copyFile(bundledUiFile, uiFile);
    source = async () => board({});
    const edited = await serve(uiFile, (nowMs) => source(nowMs));
    try {
      await visit({ baseUrl: edited.url, query: "intervalMs=200" });
      await waitUntilTrue(cdp, `document.body.dataset.offline === "false"`);
      await evaluate(cdp, `window.reloadProbe = "kept"`);
      await waitUntilTrue(cdp, `performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith("/api/ui-version")).length >= 3`);
      assert.equal(await evaluate(cdp, `window.reloadProbe`), "kept", "中身が変わらないうちは読み込み直さない");
      const original = await readFile(uiFile, "utf8");
      assert.match(original, /<title>Usage Board<\/title>/);
      await writeFile(uiFile, original.replace("<title>Usage Board</title>", "<title>Usage Board edited</title>"));
      await waitUntilTrue(cdp, `document.title === "Usage Board edited" && window.reloadProbe === undefined`);
      await waitUntilTrue(cdp, `document.body.dataset.offline === "false"`);
    } finally {
      await edited.close();
    }
  });

  test("描画の script が壊れたファイルを読み込んでも、直したファイルを保存すればまた読み込み直す", async () => {
    const uiFile = join(await tempDir("ui"), "board.html");
    const original = await readFile(bundledUiFile, "utf8");
    const broken = original.replace("<title>Usage Board</title>", "<title>broken</title>").replace("function show(board) {", "function show(board) {{");
    assert.notEqual(broken.indexOf("{{"), -1);
    await writeFile(uiFile, broken);
    source = async () => board({});
    const edited = await serve(uiFile, (nowMs) => source(nowMs));
    try {
      await visit({ baseUrl: edited.url, query: "intervalMs=200" });
      await waitUntilTrue(cdp, `document.title === "broken" && performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith("/api/ui-version")).length >= 2`);
      assert.equal(await evaluate(cdp, `document.body.dataset.offline ?? null`), null, "描画の script は動いていない");
      await writeFile(uiFile, original.replace("<title>Usage Board</title>", "<title>fixed</title>"));
      await waitUntilTrue(cdp, `document.title === "fixed" && document.body.dataset.offline === "false"`);
    } finally {
      await edited.close();
    }
  });
});
