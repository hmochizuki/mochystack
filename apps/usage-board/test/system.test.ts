import assert from "node:assert/strict";
import { test } from "node:test";
import { cpuBusyPercentage, memoryUsedPercentage } from "../src/system.ts";

test("memory_pressure の空きの割合から、使っている割合を出す", () => {
  const output = "The system has 34359738368 (2097152 pages with a page size of 16384).\nSystem-wide memory free percentage: 46%\n";
  assert.equal(memoryUsedPercentage(output), 54);
});

test("memory_pressure の出力に空きの割合が無ければ null を返す", () => {
  assert.equal(memoryUsedPercentage("unexpected"), null);
});

test("2回の CPU の累計時間の差から、全コアを合わせた使用率を出す", () => {
  const before = [
    { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
    { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 },
  ];
  const after = [
    { user: 160, nice: 0, sys: 90, idle: 950, irq: 0 },
    { user: 20, nice: 0, sys: 0, idle: 1180, irq: 0 },
  ];
  assert.equal(cpuBusyPercentage(before, after), 30);
});

test("CPU の累計時間が進んでいなければ null を返す", () => {
  const times = [{ user: 1, nice: 0, sys: 1, idle: 1, irq: 0 }];
  assert.equal(cpuBusyPercentage(times, times), null);
});
