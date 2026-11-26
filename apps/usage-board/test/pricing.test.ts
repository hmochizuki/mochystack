import assert from "node:assert/strict";
import { test } from "node:test";
import { costUsd } from "../src/pricing.ts";

function assertClose(actual: number | null, expected: number): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

const zero = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

test("Opus 5.5 は入力・出力・5分と1時間のキャッシュ書き込み・読み込みをそれぞれの単価で足す", () => {
  const cost = costUsd({
    model: "claude-opus-5-5",
    speed: "standard",
    tokens: { input: 1_000_000, output: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000 },
  });
  assertClose(cost, 4 + 20 + 5 + 8 + 0.2);
});

test("Haiku 5.5 はプロンプトが10万トークンを超えると高い単価になる", () => {
  const short = costUsd({ model: "claude-haiku-5-5", speed: "standard", tokens: { ...zero, input: 100_000, output: 1_000_000 } });
  const long = costUsd({ model: "claude-haiku-5-5", speed: "standard", tokens: { ...zero, input: 1, cacheRead: 100_000, output: 1_000_000 } });
  assertClose(short, 0.01 + 0.5);
  assertClose(long, 0.0000005 + 0.005 + 2.5);
});

test("日付の付いたモデル名は日付を外して単価を引く", () => {
  const cost = costUsd({ model: "claude-haiku-4-5-20251001", speed: "standard", tokens: { ...zero, output: 1_000_000 } });
  assertClose(cost, 5);
});

test("単価を知らないモデルは 0 ではなく null を返す", () => {
  assert.equal(costUsd({ model: "claude-unknown-9", speed: "standard", tokens: { ...zero, output: 10 } }), null);
});

test("standard 以外の速度は単価を確かめていないので null を返す", () => {
  assert.equal(costUsd({ model: "claude-opus-5-5", speed: "fast", tokens: { ...zero, output: 10 } }), null);
});
