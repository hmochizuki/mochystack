import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createTranscriptStore, type UsageRecord } from "../src/transcripts.ts";
import {
  agentResultLine,
  appendText,
  assistantLine,
  taskNotificationLine,
  tempDir,
  titleLine,
  writeLines,
} from "./fixtures.ts";

const now = Date.parse("2026-11-26T03:00:00.000Z");
const dayMs = 86_400_000;
const session = "11111111-1111-4111-8111-111111111111";

function records(store: { usageRecords(): Iterable<UsageRecord> }): UsageRecord[] {
  return [...store.usageRecords()].sort((a, b) => a.messageId.localeCompare(b.messageId));
}

test("同じ message.id の行は、ブロックごとに分かれていても別ファイルにあっても1件に数える", async () => {
  const projects = await tempDir("projects");
  const line = (block: string) =>
    assistantLine({ messageId: "msg_a", sessionId: session, timestamp: "2026-11-26T01:00:00.000Z", usage: { input: 3, output: 7 } }) +
    block;
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [line(""), line(" ")]);
  await writeLines(join(projects, "-work-a", "22222222-2222-4222-8222-222222222222.jsonl"), [line("")]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  assert.equal(records(store).length, 1);
  assert.deepEqual(records(store)[0]?.billings, [
    { model: "claude-opus-5-5", speed: "standard", tokens: { input: 3, output: 7, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 } },
  ]);
});

test("iterations があれば上位の usage ではなく iteration ごとに、それぞれのモデルで数える", async () => {
  const projects = await tempDir("projects");
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [
    assistantLine({
      messageId: "msg_adv",
      sessionId: session,
      timestamp: "2026-11-26T01:00:00.000Z",
      model: "claude-sonnet-5-5",
      usage: { input: 4, output: 30, cacheWrite1h: 10, cacheRead: 100 },
      iterations: [
        { type: "message", usage: { input: 2, output: 10, cacheWrite1h: 10, cacheRead: 50 } },
        { type: "advisor_message", model: "claude-opus-5-5", usage: { input: 900, output: 60 } },
        { type: "message", usage: { input: 2, output: 20, cacheWrite5m: 5, cacheRead: 50 } },
      ],
    }),
  ]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  assert.deepEqual(
    records(store)[0]?.billings.map((billing) => [billing.model, billing.tokens]),
    [
      ["claude-sonnet-5-5", { input: 2, output: 10, cacheWrite5m: 0, cacheWrite1h: 10, cacheRead: 50 }],
      ["claude-opus-5-5", { input: 900, output: 60, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }],
      ["claude-sonnet-5-5", { input: 2, output: 20, cacheWrite5m: 5, cacheWrite1h: 0, cacheRead: 50 }],
    ],
  );
});

test("サブエージェントの記録は親のセッションに付き、<synthetic> のモデルは数えない", async () => {
  const projects = await tempDir("projects");
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [
    assistantLine({ messageId: "msg_main", sessionId: session, timestamp: "2026-11-26T01:00:00.000Z", usage: { output: 1 } }),
    assistantLine({
      messageId: "msg_synthetic",
      sessionId: session,
      timestamp: "2026-11-26T01:00:00.000Z",
      model: "<synthetic>",
      usage: {},
    }),
  ]);
  await writeLines(join(projects, "-work-a", session, "subagents", "agent-a0000000000000001.jsonl"), [
    assistantLine({
      messageId: "msg_sub",
      sessionId: session,
      agentId: "a0000000000000001",
      cwd: "/work/sample-project/.claude/worktrees/agent-a0000000000000001",
      timestamp: "2026-11-26T01:05:00.000Z",
      usage: { output: 2 },
    }),
  ]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  assert.deepEqual(
    records(store).map((record) => [record.messageId, record.sessionId, record.project]),
    [
      ["msg_main", session, "sample-project"],
      ["msg_sub", session, null],
    ],
  );
});

test("追記された行だけを読み、改行で終わっていない行は次の更新まで読まない", async () => {
  const projects = await tempDir("projects");
  const file = join(projects, "-work-a", `${session}.jsonl`);
  const line = (id: string) =>
    assistantLine({ messageId: id, sessionId: session, timestamp: "2026-11-26T01:00:00.000Z", usage: { output: 1 } });
  await writeLines(file, [line("msg_1")]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  const half = Math.floor(line("msg_2").length / 2);
  await appendText(file, line("msg_2").slice(0, half));
  await store.refresh(now);
  assert.deepEqual(records(store).map((record) => record.messageId), ["msg_1"]);
  await appendText(file, `${line("msg_2").slice(half)}\n`);
  await store.refresh(now);
  assert.deepEqual(records(store).map((record) => record.messageId), ["msg_1", "msg_2"]);
});

test("同時に呼ばれた更新は1回分の読み込みにまとまる", async () => {
  const projects = await tempDir("projects");
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [
    assistantLine({ messageId: "msg_1", sessionId: session, timestamp: "2026-11-26T01:00:00.000Z", usage: { output: 1 } }),
  ]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  assert.equal(store.warm, false);
  const first = store.refresh(now);
  assert.equal(store.refresh(now), first);
  await first;
  assert.equal(store.warm, true);
});

test("表示期間より前に更新されたファイルは読まず、期間外になった記録は捨てる", async () => {
  const projects = await tempDir("projects");
  await writeLines(
    join(projects, "-work-a", "33333333-3333-4333-8333-333333333333.jsonl"),
    [assistantLine({ messageId: "msg_old", sessionId: session, timestamp: "2026-10-01T00:00:00.000Z", usage: { output: 1 } })],
    now - 20 * dayMs,
  );
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [
    assistantLine({ messageId: "msg_edge", sessionId: session, timestamp: "2026-11-20T00:00:00.000Z", usage: { output: 1 } }),
  ]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  assert.deepEqual(records(store).map((record) => record.messageId), ["msg_edge"]);
  await store.refresh(Date.parse("2026-12-05T00:00:00.000Z"));
  assert.deepEqual(records(store), []);
});

test("サブエージェントの終わりを、完了通知と同期実行の結果から拾う", async () => {
  const projects = await tempDir("projects");
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [
    agentResultLine({ sessionId: session, agentId: "a0000000000000001", status: "async_launched" }),
    agentResultLine({ sessionId: session, agentId: "a0000000000000002", status: "completed" }),
    taskNotificationLine({ sessionId: session, agentId: "a0000000000000003", status: "killed" }),
  ]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  assert.equal(store.agentOutcome("a0000000000000001"), undefined);
  assert.equal(store.agentOutcome("a0000000000000002"), "completed");
  assert.equal(store.agentOutcome("a0000000000000003"), "killed");
});

test("セッションの題名は最後に付いた ai-title を使う", async () => {
  const projects = await tempDir("projects");
  await writeLines(join(projects, "-work-a", `${session}.jsonl`), [
    titleLine({ sessionId: session, title: "first" }),
    titleLine({ sessionId: session, title: "second" }),
  ]);
  const store = createTranscriptStore({ projectsDir: projects, windowMs: 14 * dayMs });
  await store.refresh(now);
  assert.equal(store.sessionTitle(session), "second");
});
