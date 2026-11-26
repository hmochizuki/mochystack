import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Board } from "../src/board.ts";
import { isObject, numberAt, objectAt, parseJson, stringAt, type JsonObject } from "../src/json.ts";
import { startServer } from "../src/server.ts";
import type { UsageTotals } from "../src/usage.ts";
import { tempDir } from "./fixtures.ts";

const chromePath = [
  process.env["CHROME_PATH"],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path !== undefined && existsSync(path));

const minuteMs = 60_000;

function crowdedBoard(nowMs: number): Board {
  const totals: UsageTotals = {
    tokens: { input: 1000, output: 2000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1_500_000 },
    costUsd: 1.5,
    unpricedModels: [],
  };
  return {
    generatedAtMs: nowMs,
    timeZone: "Asia/Tokyo",
    rateLimits: { status: "unavailable", reason: "synthetic" },
    usage: {
      status: "ready",
      summary: {
        days: Array.from({ length: 14 }, (_, index) => ({ date: `2026-11-${index + 10}`, totals })),
        sessions: Array.from({ length: 30 }, (_, index) => ({
          sessionId: `session-${index}`,
          project: "sample-project",
          title: `sample session ${index}`,
          lastActivityMs: nowMs - index * minuteMs,
          totals,
        })),
      },
    },
    live: Array.from({ length: 40 }, (_, index) => ({
      pid: index + 1,
      sessionId: `session-${index}`,
      name: `sample session ${index}`,
      project: "sample-project",
      status: "busy",
      waitingFor: null,
      startedAtMs: nowMs - 60 * minuteMs,
      statusUpdatedAtMs: nowMs - minuteMs,
      subagents: [],
    })),
  };
}

const patienceMs = 30_000;

async function waitFor<T>(probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + patienceMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${patienceMs}ミリ秒待っても条件を満たさない`);
}

type Cdp = { send(method: string, params?: JsonObject): Promise<JsonObject> };

async function connectCdp(url: string): Promise<{ cdp: Cdp; close(): void }> {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const pending = new Map<number, (message: JsonObject) => void>();
  socket.addEventListener("message", (event) => {
    const message = parseJson(String(event.data));
    const id = isObject(message) ? numberAt(message, "id") : undefined;
    if (!isObject(message) || id === undefined) return;
    pending.get(id)?.(message);
    pending.delete(id);
  });
  let lastId = 0;
  const cdp: Cdp = {
    send(method, params = {}) {
      lastId += 1;
      const id = lastId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} に${patienceMs}ミリ秒たっても応答が無い`)), patienceMs);
        pending.set(id, (message) => {
          clearTimeout(timer);
          const error = objectAt(message, "error");
          if (error === undefined) resolve(objectAt(message, "result") ?? {});
          else reject(new Error(`${method}: ${JSON.stringify(error)}`));
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
  return { cdp, close: () => socket.close() };
}

async function launchChrome(executable: string): Promise<{ cdp: Cdp; close(): Promise<void> }> {
  const userDataDir = await tempDir("chrome");
  const chrome = spawn(
    executable,
    [
      "--headless=new",
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=0",
      "--window-size=1180,820",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-mock-keychain",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  async function stop(): Promise<void> {
    chrome.kill();
    await exited;
    await rm(userDataDir, { recursive: true, force: true });
  }
  try {
    const port = await waitFor(async () => {
      const text = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8");
      const parsed = Number(text.split("\n")[0]);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    });
    const targets = parseJson(await (await fetch(`http://127.0.0.1:${port}/json/list`)).text());
    const page = Array.isArray(targets) ? targets.filter(isObject).find((target) => target["type"] === "page") : undefined;
    const pageUrl = page && stringAt(page, "webSocketDebuggerUrl");
    assert.ok(pageUrl !== undefined);
    const connection = await connectCdp(pageUrl);
    return {
      cdp: connection.cdp,
      async close() {
        connection.close();
        await stop();
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function evaluate(cdp: Cdp, expression: string): Promise<unknown> {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response["exceptionDetails"] !== undefined) throw new Error(JSON.stringify(response["exceptionDetails"]));
  return objectAt(response, "result")?.["value"];
}

async function waitUntilTrue(cdp: Cdp, expression: string): Promise<void> {
  await waitFor(async () => ((await evaluate(cdp, expression)) === true ? true : undefined));
}

const shortenRefreshInterval =
  "(() => { const original = window.setInterval; window.setInterval = (handler, _timeout, ...args) => original(handler, 200, ...args); })();";

test(
  "更新でパネルを差し替えても、横向きの画面でパネルのスクロール位置を保つ",
  { skip: chromePath === undefined && "Chrome が見つからない" },
  async () => {
    assert.ok(chromePath !== undefined);
    const server = await startServer({
      board: { snapshot: async (nowMs) => crowdedBoard(nowMs) },
      host: "127.0.0.1",
      port: 0,
      allowedHosts: [],
    });
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const pageUrl = `http://127.0.0.1:${address.port}/`;
    const chrome = await launchChrome(chromePath);
    try {
      const { cdp } = chrome;
      await cdp.send("Page.enable");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: shortenRefreshInterval });
      await cdp.send("Page.navigate", { url: pageUrl });
      await waitUntilTrue(cdp, `location.href === ${JSON.stringify(pageUrl)} && document.readyState === "complete"`);
      const scrolled = await evaluate(
        cdp,
        `(() => {
          document.querySelector("main").dataset.probe = "before-refresh";
          const panels = [...document.querySelectorAll(".usage, .live")];
          for (const panel of panels) panel.scrollTop = 200;
          return panels.map((panel) => panel.scrollTop);
        })()`,
      );
      assert.deepEqual(scrolled, [200, 200]);
      await waitUntilTrue(cdp, `document.querySelector("main").dataset.probe === undefined && document.body.dataset.offline === "false"`);
      const refreshed = await evaluate(cdp, `[...document.querySelectorAll(".usage, .live")].map((panel) => panel.scrollTop)`);
      assert.deepEqual(refreshed, [200, 200]);
    } finally {
      await chrome.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
