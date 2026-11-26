import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { configFromEnv } from "../src/config.ts";

test("環境変数が無ければ ~/.claude と ~/claude-queue/usage.json を読み、手元からだけ受け付ける", () => {
  const config = configFromEnv({}, "/home/someone");
  assert.equal(config.board.claudeDir, "/home/someone/.claude");
  assert.equal(config.board.rateLimitsFile, "/home/someone/claude-queue/usage.json");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4317);
  assert.deepEqual(config.allowedHosts, []);
});

test("環境変数が無ければ、同梱の public/board.html を画面として返す", () => {
  const config = configFromEnv({}, "/home/someone");
  assert.equal(config.uiFile, fileURLToPath(new URL("../public/board.html", import.meta.url)));
  assert.ok(existsSync(config.uiFile));
});

test("USAGE_BOARD_UI_FILE で画面のファイルを差し替え、相対パスは起動したフォルダから解決する", () => {
  assert.equal(configFromEnv({ USAGE_BOARD_UI_FILE: "/data/board.html" }, "/home/someone").uiFile, "/data/board.html");
  assert.equal(configFromEnv({ USAGE_BOARD_UI_FILE: "ui/board.html" }, "/home/someone").uiFile, resolve("ui/board.html"));
});

test("環境変数で読む場所と待ち受けを変える", () => {
  const config = configFromEnv(
    {
      CLAUDE_CONFIG_DIR: "/data/claude",
      USAGE_BOARD_RATE_LIMITS_FILE: "/data/usage.json",
      USAGE_BOARD_HOST: "0.0.0.0",
      USAGE_BOARD_PORT: "8080",
      USAGE_BOARD_ALLOWED_HOSTS: "mac.tailnet.example, 192.168.1.20,",
    },
    "/home/someone",
  );
  assert.equal(config.board.claudeDir, "/data/claude");
  assert.equal(config.board.rateLimitsFile, "/data/usage.json");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.deepEqual(config.allowedHosts, ["mac.tailnet.example", "192.168.1.20"]);
});

test("数字でないポートは受け付けない", () => {
  assert.throws(() => configFromEnv({ USAGE_BOARD_PORT: "http" }, "/home/someone"), /USAGE_BOARD_PORT/);
});
