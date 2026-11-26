import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { readLiveSessions } from "../src/live.ts";
import { tempDir, writeLines } from "./fixtures.ts";

const now = Date.now();
const minuteMs = 60_000;
const cwd = "/work/sample-project";
const slug = "-work-sample-project";

async function writeSession(claudeDir: string, session: Record<string, unknown>): Promise<void> {
  await mkdir(join(claudeDir, "sessions"), { recursive: true });
  await writeFile(join(claudeDir, "sessions", `${String(session["pid"])}.json`), JSON.stringify(session));
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(child.pid !== undefined);
  return child.pid;
}

test("プロセスが生きているセッションだけを、状態とサブエージェント付きで返す", async () => {
  const claudeDir = await tempDir("claude");
  const sessionId = "11111111-1111-4111-8111-111111111111";
  await writeSession(claudeDir, {
    pid: process.pid,
    sessionId,
    cwd,
    name: "sample-session",
    status: "waiting",
    waitingFor: "input needed",
    kind: "interactive",
    startedAt: now - 30 * minuteMs,
    statusUpdatedAt: now - minuteMs,
  });
  await writeSession(claudeDir, {
    pid: deadPid(),
    sessionId: "22222222-2222-4222-8222-222222222222",
    cwd,
    status: "busy",
    startedAt: now - 30 * minuteMs,
  });
  const subagents = join(claudeDir, "projects", slug, sessionId, "subagents");
  await writeLines(join(subagents, "agent-a0000000000000001.jsonl"), ["{}"], now - minuteMs);
  await writeFile(
    join(subagents, "agent-a0000000000000001.meta.json"),
    JSON.stringify({ agentType: "general-purpose", name: "worker-one", description: "synthetic task", model: "opus" }),
  );
  await writeLines(join(subagents, "agent-a0000000000000002.jsonl"), ["{}"], now - 2 * minuteMs);
  await writeLines(join(subagents, "agent-a0000000000000003.jsonl"), ["{}"], now - 60 * minuteMs);
  await writeLines(join(subagents, "agent-a0000000000000004.jsonl"), ["{}"], now - 20 * minuteMs);

  const outcomes = new Map([
    ["a0000000000000002", "completed"],
    ["a0000000000000004", "completed"],
  ]);
  const sessions = await readLiveSessions({
    claudeDir,
    nowMs: now,
    finishedVisibleMs: 10 * minuteMs,
    agentOutcome: (agentId) => outcomes.get(agentId),
  });

  assert.deepEqual(sessions, [
    {
      pid: process.pid,
      sessionId,
      name: "sample-session",
      project: "sample-project",
      status: "waiting",
      waitingFor: "input needed",
      startedAtMs: now - 30 * minuteMs,
      statusUpdatedAtMs: now - minuteMs,
      subagents: [
        {
          agentId: "a0000000000000001",
          label: "worker-one",
          agentType: "general-purpose",
          model: "opus",
          state: "running",
          lastWriteMs: now - minuteMs,
        },
        {
          agentId: "a0000000000000002",
          label: "a0000000000000002",
          agentType: null,
          model: null,
          state: "completed",
          lastWriteMs: now - 2 * minuteMs,
        },
      ],
    },
  ]);
});

test("セッションのフォルダが無ければ空の一覧を返す", async () => {
  const claudeDir = await tempDir("claude");
  assert.deepEqual(
    await readLiveSessions({ claudeDir, nowMs: now, finishedVisibleMs: minuteMs, agentOutcome: () => undefined }),
    [],
  );
});

test("入力待ち、実行中、その他の順に並べ、同じ状態の中では状態が新しい順にする", async () => {
  const claudeDir = await tempDir("claude");
  const base = { cwd, startedAt: now - 60 * minuteMs };
  const others = [process.ppid, process.pid];
  await writeSession(claudeDir, { ...base, pid: others[0], sessionId: "idle", status: "idle", statusUpdatedAt: now });
  await writeSession(claudeDir, { ...base, pid: others[1], sessionId: "busy", status: "busy", statusUpdatedAt: now - minuteMs });
  const sessions = await readLiveSessions({ claudeDir, nowMs: now, finishedVisibleMs: minuteMs, agentOutcome: () => undefined });
  assert.deepEqual(
    sessions.map((session) => session.sessionId),
    ["busy", "idle"],
  );
});
