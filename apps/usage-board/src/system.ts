import { execFile } from "node:child_process";
import { cpus } from "node:os";

export type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number };

export type SystemView = { memoryUsedPercentage: number | null; cpuBusyPercentage: number | null };

export function memoryUsedPercentage(memoryPressureOutput: string): number | null {
  const match = /memory free percentage:\s*(\d+)%/.exec(memoryPressureOutput);
  return match?.[1] === undefined ? null : 100 - Number(match[1]);
}

export function cpuBusyPercentage(before: CpuTimes[], after: CpuTimes[]): number | null {
  let busy = 0;
  let total = 0;
  after.forEach((now, index) => {
    const then = before[index];
    if (then === undefined) return;
    const idle = now.idle - then.idle;
    const used = now.user - then.user + (now.nice - then.nice) + (now.sys - then.sys) + (now.irq - then.irq);
    busy += used;
    total += used + idle;
  });
  return total > 0 ? Math.round((busy / total) * 100) : null;
}

function readMemoryPressure(): Promise<string> {
  return new Promise((resolve) => {
    execFile("memory_pressure", ["-Q"], { timeout: 5000 }, (error, stdout) => resolve(error === null ? stdout : ""));
  });
}

export function createSystemProbe(): { sample(): Promise<SystemView> } {
  let previous = cpus().map((cpu) => cpu.times);
  return {
    async sample() {
      const current = cpus().map((cpu) => cpu.times);
      const cpuBusy = cpuBusyPercentage(previous, current);
      previous = current;
      return { memoryUsedPercentage: memoryUsedPercentage(await readMemoryPressure()), cpuBusyPercentage: cpuBusy };
    },
  };
}
