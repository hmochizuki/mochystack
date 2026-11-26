import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createBoard } from "../src/board.ts";
import { isObject } from "../src/json.ts";
import { startServer } from "../src/server.ts";
import { assistantLine, tempDir, writeLines } from "./fixtures.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
let baseUrl = "";
let port = 0;
let uiFile = "";
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
  uiFile = join(await tempDir("ui"), "board.html");
  await writeFile(uiFile, "<!doctype html><title>first</title>");
  const server = await startServer({
    board: createBoard({ claudeDir, rateLimitsFile, timeZone: "Asia/Tokyo" }),
    uiFile,
    host: "127.0.0.1",
    port: 0,
    allowedHosts: ["usage-board.example"],
  });
  port = portOf(server);
  baseUrl = `http://127.0.0.1:${port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(() => close());

function portOf(server: Server): number {
  const address: AddressInfo | string | null = server.address();
  assert.ok(address !== null && typeof address === "object");
  return address.port;
}

function statusFor(options: { port: number; path: string; host: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: "127.0.0.1", port: options.port, path: options.path, headers: { host: options.host } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

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

async function uiVersion(): Promise<string> {
  const body: unknown = await (await fetch(`${baseUrl}/api/ui-version`)).json();
  assert.ok(isObject(body));
  const version = body["version"];
  assert.ok(typeof version === "string" && version !== "");
  return version;
}

test("/ は UI のファイルの中身をそのまま HTML として返す", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html; charset=utf-8$/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), await readFile(uiFile, "utf8"));
});

test("UI のファイルを書き換えると、再起動しなくても次の / から新しい中身を返し、/api/ui-version の値も変わる", async () => {
  const before = await uiVersion();
  assert.equal(await uiVersion(), before);
  await writeFile(uiFile, "<!doctype html><title>second</title>");
  assert.equal(await (await fetch(`${baseUrl}/`)).text(), "<!doctype html><title>second</title>");
  const after = await uiVersion();
  assert.notEqual(after, before);
  await writeFile(uiFile, "<!doctype html><title>second</title>");
  assert.equal(await uiVersion(), after, "中身が同じなら値は変わらない");
});

test("UI のファイルが読めないときは、/ と /api/ui-version が 500 を返す", async () => {
  const claudeDir = await tempDir("claude");
  const server = await startServer({
    board: createBoard({ claudeDir, rateLimitsFile: join(claudeDir, "usage.json"), timeZone: "Asia/Tokyo" }),
    uiFile: join(claudeDir, "missing.html"),
    host: "127.0.0.1",
    port: 0,
    allowedHosts: [],
  });
  try {
    const missingUrl = `http://127.0.0.1:${portOf(server)}`;
    assert.equal((await fetch(`${missingUrl}/`)).status, 500);
    assert.equal((await fetch(`${missingUrl}/api/ui-version`)).status, 500);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("UI のファイルのほかには、どのファイルも返さない", async () => {
  for (const path of ["/nope", "/board.html", "/public/board.html", "/..%2fpackage.json", "/%2e%2e/package.json", "/api/ui-version/"]) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
  }
});

test("GET 以外は 405 を返す", async () => {
  for (const path of ["/", "/api/board", "/api/ui-version"]) {
    assert.equal((await fetch(`${baseUrl}${path}`, { method: "POST" })).status, 405, path);
  }
});

test("Host が待ち受けている名前でないリクエストは、どのパスでも 403 を返す", async () => {
  for (const path of ["/", "/api/board", "/api/ui-version", "/nope"]) {
    assert.equal(await statusFor({ port, path, host: "evil.example" }), 403, path);
    assert.equal(await statusFor({ port, path, host: `evil.example:${port}` }), 403, path);
  }
});

test("localhost、127.0.0.1、待ち受けるアドレス、追加で許した名前の Host は受け付ける", async () => {
  for (const host of [`localhost:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port}`, "usage-board.example"]) {
    assert.equal(await statusFor({ port, path: "/api/board", host }), 200, host);
  }
});

const lanAddress = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .find((address) => address.family === "IPv4" && !address.internal)?.address;

test(
  "0.0.0.0 で待ち受けるときは、Mac のネットワークのアドレスの Host を受け付ける",
  { skip: lanAddress === undefined && "ループバック以外の IPv4 アドレスが無い" },
  async () => {
    const claudeDir = await tempDir("claude");
    const server = await startServer({
      board: createBoard({ claudeDir, rateLimitsFile: join(claudeDir, "usage.json"), timeZone: "Asia/Tokyo" }),
      uiFile,
      host: "0.0.0.0",
      port: 0,
      allowedHosts: [],
    });
    try {
      const wildcardPort = portOf(server);
      assert.equal(await statusFor({ port: wildcardPort, path: "/api/board", host: `${lanAddress}:${wildcardPort}` }), 200);
      assert.equal(await statusFor({ port: wildcardPort, path: "/api/board", host: "0.0.0.0" }), 403);
      assert.equal(await statusFor({ port: wildcardPort, path: "/api/board", host: "evil.example" }), 403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
