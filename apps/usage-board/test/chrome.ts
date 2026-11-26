import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isObject, numberAt, objectAt, parseJson, stringAt, type JsonObject } from "../src/json.ts";
import { tempDir } from "./fixtures.ts";

export const chromePath = [
  process.env["CHROME_PATH"],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path !== undefined && existsSync(path));

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

export type Cdp = { send(method: string, params?: JsonObject): Promise<JsonObject> };

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

export type Chrome = { cdp: Cdp; close(): Promise<void> };

export async function launchChrome(executable: string): Promise<Chrome> {
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

export async function evaluate(cdp: Cdp, expression: string): Promise<unknown> {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response["exceptionDetails"] !== undefined) throw new Error(JSON.stringify(response["exceptionDetails"]));
  return objectAt(response, "result")?.["value"];
}

export async function waitUntilTrue(cdp: Cdp, expression: string): Promise<void> {
  await waitFor(async () => ((await evaluate(cdp, expression)) === true ? true : undefined));
}
