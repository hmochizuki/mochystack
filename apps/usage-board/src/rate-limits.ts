import { readFile, stat } from "node:fs/promises";
import { isObject, numberAt, objectAt, parseJson, type JsonObject } from "./json.ts";

export type RateWindowView =
  | { state: "active"; usedPercentage: number; resetsAtMs: number }
  | { state: "reset"; resetsAtMs: number }
  | { state: "absent" };

export type RateLimitsView =
  | { status: "unavailable"; reason: string }
  | { status: "available"; capturedAtMs: number; fiveHour: RateWindowView; sevenDay: RateWindowView };

function windowView(snapshot: JsonObject, key: string, nowMs: number): RateWindowView {
  const window = objectAt(snapshot, key);
  if (window === undefined) return { state: "absent" };
  const usedPercentage = numberAt(window, "used_percentage");
  const resetsAt = numberAt(window, "resets_at");
  if (usedPercentage === undefined || resetsAt === undefined) return { state: "absent" };
  const resetsAtMs = resetsAt * 1000;
  return resetsAtMs <= nowMs ? { state: "reset", resetsAtMs } : { state: "active", usedPercentage, resetsAtMs };
}

export async function readRateLimits(file: string, nowMs: number): Promise<RateLimitsView> {
  let text: string;
  let modifiedMs: number;
  try {
    [text, modifiedMs] = await Promise.all([readFile(file, "utf8"), stat(file).then((s) => s.mtimeMs)]);
  } catch {
    return { status: "unavailable", reason: `statusline の rate_limits を書き出したファイル ${file} が読めない` };
  }
  const snapshot = parseJson(text);
  if (!isObject(snapshot)) {
    return { status: "unavailable", reason: `${file} を JSON として読めない` };
  }
  const fiveHour = windowView(snapshot, "five_hour", nowMs);
  const sevenDay = windowView(snapshot, "seven_day", nowMs);
  if (fiveHour.state === "absent" && sevenDay.state === "absent") {
    return { status: "unavailable", reason: `${file} に five_hour も seven_day も入っていない` };
  }
  const capturedAt = numberAt(snapshot, "captured_at");
  return {
    status: "available",
    capturedAtMs: capturedAt === undefined ? Math.round(modifiedMs) : capturedAt * 1000,
    fiveHour,
    sevenDay,
  };
}
