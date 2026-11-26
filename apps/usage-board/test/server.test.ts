import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createBoard } from "../src/board.ts";
import { isObject } from "../src/json.ts";
import { startServer } from "../src/server.ts";
import { assistantLine, tempDir, writeLines } from "./fixtures.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
let baseUrl = "";
let close: () => Promise<void> = async () => {};
const nowSeconds = Math.floor(Date.now() / 1000);

before(async () => {
  const claudeDir = await tempDir("claude");
  await writeLines(join(claudeDir, "projects", "-work-sample-project", `${sessionId}.jsonl`), [
    assistantLine({ messageId: "msg_1", sessionId, timestamp: new Date().toISOString(), usage: { input: 10, output: 1_000_000 } }),
  ]);
  const rateLimitsFile = join(claudeDir, "usage.json");
  await writeFile(
    rateLimitsFile,
    JSON.stringify({ five_hour: { used_percentage: 25, resets_at: nowSeconds + 3600 }, captured_at: nowSeconds }),
  );
  const server = await startServer({
    board: createBoard({ claudeDir, rateLimitsFile, timeZone: "Asia/Tokyo" }),
    host: "127.0.0.1",
    port: 0,
  });
  const address: AddressInfo | string | null = server.address();
  assert.ok(isObject(address) && typeof address.port === "number");
  baseUrl = `http://127.0.0.1:${address.port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(() => close());

async function readyBoard(): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const body: unknown = await (await fetch(`${baseUrl}/api/board`)).json();
    if (isObject(body) && isObject(body["usage"]) && body["usage"]["status"] === "ready") return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("usage が ready にならない");
}

test("/api/board は3つのパネルの元データを JSON で返す", async () => {
  const board = await readyBoard();
  const rateLimits = board["rateLimits"];
  assert.ok(isObject(rateLimits));
  assert.equal(rateLimits["status"], "available");
  assert.deepEqual(rateLimits["fiveHour"], { state: "active", usedPercentage: 25, resetsAtMs: (nowSeconds + 3600) * 1000 });
  assert.deepEqual(rateLimits["sevenDay"], { state: "absent" });
  const usage = board["usage"];
  assert.ok(isObject(usage) && isObject(usage["summary"]));
  const days = usage["summary"]["days"];
  assert.ok(Array.isArray(days) && days.length === 14);
  const today: unknown = days.at(-1);
  assert.ok(isObject(today) && isObject(today["totals"]));
  assert.equal(today["totals"]["costUsd"], 20.00004);
  assert.deepEqual(board["live"], []);
});

test("/ は HTML のダッシュボードを返す", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.match(html, /残り\s*<strong>75%<\/strong>/);
  assert.match(html, /\$20\.00/);
});

test("知らないパスは 404、GET 以外は 405 を返す", async () => {
  assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/`, { method: "POST" })).status, 405);
});
