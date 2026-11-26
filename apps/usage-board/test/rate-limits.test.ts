import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRateLimits } from "../src/rate-limits.ts";

const now = Date.UTC(2026, 10, 26, 3, 0, 0);
const seconds = (ms: number): number => Math.floor(ms / 1000);

async function snapshotFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "usage-board-rate-"));
  const file = join(dir, "usage.json");
  await writeFile(file, content);
  return file;
}

test("statusline が書き出した5時間枠と週の枠を、使用率とリセット時刻にする", async () => {
  const file = await snapshotFile(
    JSON.stringify({
      five_hour: { used_percentage: 17, resets_at: seconds(now) + 3600 },
      seven_day: { used_percentage: 46.5, resets_at: seconds(now) + 86_400 },
      captured_at: seconds(now) - 30,
    }),
  );
  assert.deepEqual(await readRateLimits(file, now), {
    status: "available",
    capturedAtMs: (seconds(now) - 30) * 1000,
    fiveHour: { state: "active", usedPercentage: 17, resetsAtMs: (seconds(now) + 3600) * 1000 },
    sevenDay: { state: "active", usedPercentage: 46.5, resetsAtMs: (seconds(now) + 86_400) * 1000 },
  });
});

test("リセット時刻を過ぎた枠は古い使用率を出さずにリセット済みにする", async () => {
  const file = await snapshotFile(
    JSON.stringify({
      five_hour: { used_percentage: 90, resets_at: seconds(now) - 60 },
      seven_day: { used_percentage: 46, resets_at: seconds(now) + 86_400 },
      captured_at: seconds(now) - 7200,
    }),
  );
  const view = await readRateLimits(file, now);
  assert.equal(view.status, "available");
  if (view.status !== "available") return;
  assert.deepEqual(view.fiveHour, { state: "reset", resetsAtMs: (seconds(now) - 60) * 1000 });
});

test("片方の枠が入っていなければその枠だけ値なしにする", async () => {
  const file = await snapshotFile(
    JSON.stringify({ seven_day: { used_percentage: 46, resets_at: seconds(now) + 60 }, captured_at: seconds(now) }),
  );
  const view = await readRateLimits(file, now);
  assert.equal(view.status === "available" && view.fiveHour.state, "absent");
});

test("captured_at が無ければファイルの更新時刻を取得時刻にする", async () => {
  const file = await snapshotFile(JSON.stringify({ seven_day: { used_percentage: 1, resets_at: seconds(now) + 60 } }));
  await utimes(file, new Date(now - 5000), new Date(now - 5000));
  const view = await readRateLimits(file, now);
  assert.equal(view.status === "available" && view.capturedAtMs, now - 5000);
});

test("ファイルが無ければ、どのファイルを探したかを添えて取得できないとする", async () => {
  const view = await readRateLimits("/nonexistent/usage.json", now);
  assert.equal(view.status, "unavailable");
  assert.match(view.status === "unavailable" ? view.reason : "", /\/nonexistent\/usage\.json/);
});

test("JSON として読めなければ取得できないとする", async () => {
  const file = await snapshotFile("{not json");
  assert.equal((await readRateLimits(file, now)).status, "unavailable");
});

test("どちらの枠も無ければ取得できないとする", async () => {
  const file = await snapshotFile(JSON.stringify({ five_hour: { used_percentage: "17" }, captured_at: seconds(now) }));
  assert.equal((await readRateLimits(file, now)).status, "unavailable");
});
