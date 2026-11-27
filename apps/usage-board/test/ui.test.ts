import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Board } from "../src/board.ts";
import { isObject, numberAt } from "../src/json.ts";
import type { LiveSession } from "../src/live.ts";
import { startServer } from "../src/server.ts";
import type { UsageTotals } from "../src/usage.ts";
import { chromePath, evaluate, launchChrome, waitUntilTrue, type Cdp, type Chrome } from "./chrome.ts";
import { tempDir } from "./fixtures.ts";

const bundledUiFile = fileURLToPath(new URL("../public/board.html", import.meta.url));
const now = Date.parse("2026-11-26T03:00:00.000Z");
const minuteMs = 60_000;
const hourMs = 60 * minuteMs;

function totals(costUsd: number, unpricedModels: string[] = []): UsageTotals {
  return { tokens: { input: 1000, output: 2000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1_500_000 }, costUsd, unpricedModels };
}

function liveSession(index: number, name: string | null, status: string, waitingFor: string | null, nowMs: number): LiveSession {
  return {
    pid: index + 1,
    sessionId: `session-${index}`,
    name,
    project: "sample-project",
    status,
    waitingFor,
    startedAtMs: nowMs - 60 * minuteMs,
    statusUpdatedAtMs: nowMs - minuteMs,
    subagents: [],
  };
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
        ...liveSession(0, "sample-session", "waiting", "input needed", now),
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
  return {
    generatedAtMs: nowMs,
    timeZone: "Asia/Tokyo",
    system: { memoryUsedPercentage: 40, cpuBusyPercentage: 10 },
    rateLimits: {
      status: "available",
      capturedAtMs: nowMs,
      fiveHour: { state: "active", usedPercentage: 100, resetsAtMs: nowMs + 299 * minuteMs },
      sevenDay: { state: "active", usedPercentage: 3, resetsAtMs: nowMs + 6 * 24 * hourMs },
    },
    usage: { status: "loading" },
    live: Array.from({ length: 40 }, (_, index) => liveSession(index, `sample session ${index}`, "waiting", `permission needed ${index}`, nowMs)),
  };
}

const scenarioNow = Date.parse("2026-11-26T10:54:00.000Z");
const threeWaiting: Array<[string, string]> = [
  ["api-refactor", "テストの書き換えを続けてよいか"],
  ["billing-fix", "本番の DB に繋いでよいか"],
  ["docs-site", "見出しの案を選んでほしい"],
];
const fiveWaiting: Array<[string, string]> = [
  ["api-refactor", "テストの書き換えを続けるか、先に型の定義を直すべきか"],
  ["billing-fix", "本番の DB に繋いで、移行のスクリプトを流してよいか"],
  ["docs-site", "見出しの案を3つ作ったので、どれにするか選んでほしい"],
  ["shinsei-list", "一覧の並び順を、日付と状態のどちらにするか決めてほしい"],
  ["vrt-approval", "差分のある画面が12枚あるので、承認してよいか見てほしい"],
];
const eightRunning = ["mochystack", "craft-training", "shinsei-list", "keihi-app", "vrt-approval", "custom-scenario", "settings-app", "kashidashi-app"];
const sixRunning = ["mochystack", "craft-training", "keihi-app", "custom-scenario", "settings-app", "kashidashi-app"];

function scenario(usedPercentage: number, waiting: Array<[string, string]>, running: string[]): Board {
  return {
    generatedAtMs: scenarioNow,
    timeZone: "Asia/Tokyo",
    system: { memoryUsedPercentage: 55, cpuBusyPercentage: 23 },
    rateLimits: {
      status: "available",
      capturedAtMs: scenarioNow - minuteMs,
      fiveHour: { state: "active", usedPercentage, resetsAtMs: Date.parse("2026-11-26T15:00:00.000Z") },
      sevenDay: { state: "active", usedPercentage: 77, resetsAtMs: Date.parse("2026-11-27T21:00:00.000Z") },
    },
    usage: { status: "ready", summary: { days: [{ date: "2026-11-26", totals: totals(40) }], sessions: [] } },
    live: [
      ...waiting.map(([name, waitingFor], index) => liveSession(index, name, "waiting", waitingFor, scenarioNow)),
      ...running.map((name, index) => liveSession(waiting.length + index, name, "busy", null, scenarioNow)),
    ],
  };
}

const scenarios: Array<{ name: string; board: Board }> = [
  { name: "5時間枠を20%使った", board: scenario(20, threeWaiting, eightRunning) },
  { name: "5時間枠を43%使った", board: scenario(43, threeWaiting, eightRunning) },
  { name: "5時間枠を90%使った", board: scenario(90, threeWaiting, eightRunning) },
  { name: "5時間枠を98%使った", board: scenario(98, threeWaiting, eightRunning) },
  { name: "入力待ちが5件で内容が長い", board: scenario(43, fiveWaiting, sixRunning) },
  { name: "入力待ちが無い", board: scenario(43, [], eightRunning) },
  { name: "入力待ちも実行中も無い", board: scenario(43, [], []) },
];

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

function numbersOrNulls(value: unknown): Array<number | null> {
  assert.ok(Array.isArray(value));
  const items: unknown[] = value;
  return items.map((item) => {
    assert.ok(item === null || typeof item === "number");
    return item;
  });
}

function assertNear(actual: Array<number | null>, expected: Array<number | null>, label: string): void {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, index) => {
    const want = expected[index];
    if (want === null || want === undefined || value === null) assert.equal(value, want ?? null, label);
    else assert.ok(Math.abs(value - want) < 0.3, `${label}: ${value} は ${want} に近くない`);
  });
}

const gaugeReadings = `(part) => [...document.querySelectorAll(".plan")].map((plan) => {
  const hub = plan.querySelector(".hub");
  if (hub === null) return null;
  const cx = Number(hub.getAttribute("cx"));
  const cy = Number(hub.getAttribute("cy"));
  const reading = (x, y) => 100 * (1 - Math.atan2(cy - y, x - cx) / Math.PI);
  if (part === "needle") {
    const needle = plan.querySelector(".needle");
    if (needle === null) return null;
    const [x, y] = needle.getAttribute("points").split(" ")[0].split(",").map(Number);
    return reading(x, y);
  }
  const pace = plan.querySelector(".pace");
  return pace === null ? null : reading(Number(pace.getAttribute("x2")), Number(pace.getAttribute("y2")));
})`;

const layoutProbe = `(() => {
  const outside = [...document.querySelectorAll("main, main *")].filter((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && (box.left < -0.5 || box.top < -0.5 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5);
  }).length;
  const sessions = document.querySelector(".sessions");
  const plans = document.querySelector(".plans").getBoundingClientRect();
  const mac = document.querySelector(".mac").getBoundingClientRect();
  return {
    outside,
    hiddenSessions: sessions.scrollHeight - sessions.clientHeight,
    footerGap: mac.left - plans.right,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    overflowY: document.documentElement.scrollHeight - innerHeight,
  };
})()`;

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

  async function texts(selector: string): Promise<unknown> {
    return evaluate(cdp, `[...document.querySelectorAll(${JSON.stringify(selector)})].map((element) => element.textContent)`);
  }

  async function count(selector: string): Promise<number> {
    const value = await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
    assert.ok(typeof value === "number");
    return value;
  }

  test("5時間枠と週の枠は、残りの割合とリセットの時刻を出し、リセットを過ぎた枠は 100 にする", async () => {
    await show(board({}));
    assert.deepEqual(await texts(".plan .label"), ["5時間枠", "週の枠"]);
    assert.deepEqual(await texts(".plan .reset"), ["↻ 13:01", "↻ 11/26 11:59"]);
    assert.deepEqual(await texts(".plan .reading"), ["83%", "100%"]);
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll(".plan")].map((plan) => plan.getAttribute("aria-valuenow"))`), ["83", "100"]);
    assert.equal(await count(".plan .pace"), 1, "リセットを過ぎた枠にはペースの線を出さない");
    assert.doesNotMatch(await text("main"), /リセット済み|取得|あと/);
  });

  test("針は残りを指し、白い線は枠の時間を均等に使ったときの残りを指す", async () => {
    await show(scenario(43, threeWaiting, eightRunning));
    assertNear(numbersOrNulls(await evaluate(cdp, `(${gaugeReadings})("needle")`)), [57, 23], "針");
    assertNear(numbersOrNulls(await evaluate(cdp, `(${gaugeReadings})("pace")`)), [(246 / 300) * 100, ((34 * 60 + 6) / (7 * 24 * 60)) * 100], "ペースの線");
  });

  test("残りが15%以下の枠は、針と数字を淡い赤にする", async () => {
    await show(scenario(85, threeWaiting, eightRunning));
    const low = `[...document.querySelectorAll(".plan")].map((plan) => [getComputedStyle(plan.querySelector(".reading")).color, getComputedStyle(plan.querySelector(".needle")).fill])`;
    const lowColor = "rgb(255, 143, 112)";
    const normal = "rgb(242, 237, 228)";
    assert.deepEqual(await evaluate(cdp, low), [
      [lowColor, lowColor],
      [normal, "rgb(246, 241, 232)"],
    ]);
    await show(scenario(84, threeWaiting, eightRunning));
    assert.deepEqual(await evaluate(cdp, `${low}[0]`), [normal, "rgb(246, 241, 232)"]);
  });

  test("空は上から暗い赤で、5時間枠を使った割合の高さで青に変わる", async () => {
    const boundaryAt = (used: number) => `getComputedStyle(document.querySelector("main")).backgroundImage.includes("rgb(29, 36, 56) ${used}%")`;
    for (const used of [20, 43, 98]) {
      await show(scenario(used, threeWaiting, eightRunning));
      assert.equal(await evaluate(cdp, boundaryAt(used)), true, `${used}%`);
    }
    await show(board({ rateLimits: { status: "unavailable", reason: "statusline のファイルが無い" } }));
    assert.equal(await evaluate(cdp, boundaryAt(0)), true, "取得できないときは赤を出さない");
  });

  test("取得から15分を過ぎた残りは、いつのデータかを出し、値の無い枠は - にする", async () => {
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
    assert.equal(await text("[data-stale=true]"), "update: 20m ago");
    assert.deepEqual(await texts(".plan .reading"), ["83%", "-"]);
    assert.deepEqual(await texts(".plan .reset"), ["↻ 13:01"]);
    assert.deepEqual(numbersOrNulls(await evaluate(cdp, `(${gaugeReadings})("needle")`)).map((value) => value === null), [false, true]);
  });

  test("取得から15分以内なら、いつのデータかを出さない", async () => {
    await show(board({}));
    assert.equal(await count("[data-stale]"), 0);
  });

  test("制限が取得できないときは、両方の計器を - にし、理由の文は出さない", async () => {
    await show(board({ rateLimits: { status: "unavailable", reason: "statusline のファイルが無い" } }));
    assert.deepEqual(await texts(".plan .label"), ["5時間枠", "週の枠"]);
    assert.deepEqual(await texts(".plan .reading"), ["-", "-"]);
    assert.equal(await count(".plan .reset, .plan .needle, .plan .pace"), 0);
    assert.doesNotMatch(await text("main"), /statusline|取得できません/);
  });

  test("金額とトークン数は出さない", async () => {
    await show(board({}));
    assert.doesNotMatch(await text("main"), /\$|集計中|単価不明|1\.5M|トークン/);
    await show(board({ usage: { status: "loading" } }));
    assert.doesNotMatch(await text("main"), /集計中/);
  });

  test("入力待ちのセッションを先に名前と待っている内容で出し、実行中のセッションは次の行から名前だけを出す", async () => {
    await show({
      ...board({}),
      live: [
        liveSession(1, "busy-one", "busy", null, now),
        liveSession(2, "sample-session", "waiting", "input needed", now),
        liveSession(3, null, "waiting", null, now),
        liveSession(4, "resting-session", "idle", null, now),
        liveSession(5, "busy-two", "busy", null, now),
        liveSession(6, "odd-session", "unknown", null, now),
      ],
    });
    assert.deepEqual(await texts(".sessions > li"), ["sample-sessioninput needed", "sample-project", "busy-one", "busy-two"]);
    assert.deepEqual(await texts(".sessions > .waiting .waiting-for"), ["input needed"]);
    const rows = await evaluate(
      cdp,
      `(() => {
        const boxes = [...document.querySelectorAll(".sessions > li")].map((item) => item.getBoundingClientRect());
        return { firstLeft: boxes[0].left, runningLeft: boxes[2].left, waitingBottom: Math.max(boxes[0].bottom, boxes[1].bottom), runningTop: boxes[2].top, secondRunningTop: boxes[3].top };
      })()`,
    );
    assert.ok(isObject(rows));
    assert.equal(numberAt(rows, "runningLeft"), numberAt(rows, "firstLeft"), "実行中は1列目から始まる");
    assert.ok((numberAt(rows, "runningTop") ?? 0) >= (numberAt(rows, "waitingBottom") ?? Infinity), "実行中は入力待ちの下の行に出る");
    assert.equal(numberAt(rows, "secondRunningTop"), numberAt(rows, "runningTop"), "実行中どうしは同じ行に並ぶ");
    assert.doesNotMatch(await text("main"), /resting-session|odd-session|worker-one|件|実行中|入力待ち/);
  });

  test("セッションが無いときは、何も書かない", async () => {
    await show(board({ live: [] }));
    assert.equal(await count(".sessions > *"), 0);
    assert.equal(await text(".sessions"), "");
  });

  test("時計と、Mac のメモリと CPU の使用率を出す", async () => {
    await show(board({}));
    assert.equal(await text("#clock"), "12:00");
    assert.deepEqual(await texts(".mac .label"), ["メモリ", "CPU"]);
    assert.deepEqual(await texts(".mac strong"), ["54%", "30%"]);
  });

  test("メモリと CPU が取れないときは値の代わりに - を出す", async () => {
    await show(board({ system: { memoryUsedPercentage: null, cpuBusyPercentage: null } }));
    assert.deepEqual(await texts(".mac strong"), ["-", "-"]);
  });

  test("セッションの名前と待っている内容は HTML として解釈させない", async () => {
    const payload = `<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>`;
    await show({
      ...board({}),
      live: [liveSession(1, payload, "waiting", payload, now), liveSession(2, payload, "busy", null, now)],
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await count("main img, main script"), 0);
    assert.equal(await evaluate(cdp, `window.pwned ?? null`), null);
    assert.deepEqual(await texts(".sessions > li"), [`${payload}${payload}`, payload]);
  });

  test("定期的に /api/board を読み直して描き直し、そのあいだ画面を読み込み直さない", async () => {
    await show(board({}), { query: "intervalMs=200" });
    await evaluate(cdp, `window.reloadProbe = "kept"`);
    source = async () => board({ system: { memoryUsedPercentage: 54, cpuBusyPercentage: 77 } });
    await waitUntilTrue(cdp, `document.querySelectorAll(".mac strong")[1].textContent === "77%"`);
    assert.equal(await evaluate(cdp, `window.reloadProbe`), "kept");
  });

  test("/api/board が読めないあいだは、最後の表示を残して更新できませんと出し、読めたら消す", async () => {
    await show(board({}), { query: "intervalMs=200" });
    source = async () => {
      throw new Error("down");
    };
    await waitUntilTrue(cdp, `document.body.dataset.offline === "true"`);
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(".notice"), "::after").content`), `"更新できません"`);
    assert.equal(await count(".plan"), 2);
    source = async () => board({});
    await waitUntilTrue(cdp, `document.body.dataset.offline === "false"`);
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(".notice"), "::after").content`), "none");
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
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(".notice"), "::after").content`), `"更新できません"`);
  });

  test("時計は画面の中で進め、更新できないあいだも止めない", async () => {
    const twoHoursAgo = Date.now() - 2 * hourMs;
    await show(board({ generatedAtMs: twoHoursAgo }), { query: "intervalMs=200" });
    source = async () => {
      throw new Error("down");
    };
    await waitUntilTrue(
      cdp,
      `document.body.dataset.offline === "true" && document.querySelector("#clock").textContent === new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(Date.now())`,
    );
  });

  for (const viewport of [tablet, phoneLandscape]) {
    test(`${viewport.width}×${viewport.height} で描き直しても、セッションの一覧のスクロール位置を保つ`, async () => {
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
          document.querySelector(".sessions").scrollTop = 120;
          return document.querySelectorAll(".mac strong")[1].textContent;
        })()`,
      );
      await waitUntilTrue(cdp, `document.querySelectorAll(".mac strong")[1].textContent !== ${JSON.stringify(before)}`);
      assert.equal(await evaluate(cdp, `document.querySelector(".sessions").scrollTop`), 120);
      const layout = await evaluate(cdp, layoutProbe);
      assert.ok(isObject(layout));
      assert.equal(numberAt(layout, "overflowX"), 0, "横にはみ出さない");
      assert.equal(numberAt(layout, "overflowY"), 0, "縦にはみ出さない");
    });
  }

  for (const viewport of [phoneLandscape, tablet]) {
    for (const { name, board: next } of scenarios) {
      test(`${viewport.width}×${viewport.height} で${name}ときも、1画面に収まり、どの要素も画面の外に出ない`, async () => {
        await show(next, { viewport });
        const layout = await evaluate(cdp, layoutProbe);
        assert.ok(isObject(layout));
        assert.equal(numberAt(layout, "overflowX"), 0, "横にはみ出さない");
        assert.equal(numberAt(layout, "overflowY"), 0, "縦にはみ出さない");
        assert.equal(numberAt(layout, "outside"), 0, "画面の外に出る要素が無い");
        assert.equal(numberAt(layout, "hiddenSessions"), 0, "セッションがスクロールしないで全部見える");
        assert.ok((numberAt(layout, "footerGap") ?? -1) > 0, "計器とメモリ・CPU が重ならない");
      });
    }
  }

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
