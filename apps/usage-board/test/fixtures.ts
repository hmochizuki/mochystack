import { appendFile, mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type UsageFixture = {
  input?: number;
  output?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
};

function usageJson(usage: UsageFixture): Record<string, unknown> {
  const cacheWrite5m = usage.cacheWrite5m ?? 0;
  const cacheWrite1h = usage.cacheWrite1h ?? 0;
  return {
    input_tokens: usage.input ?? 0,
    output_tokens: usage.output ?? 0,
    cache_creation_input_tokens: cacheWrite5m + cacheWrite1h,
    cache_read_input_tokens: usage.cacheRead ?? 0,
    cache_creation: { ephemeral_5m_input_tokens: cacheWrite5m, ephemeral_1h_input_tokens: cacheWrite1h },
  };
}

export function assistantLine(options: {
  messageId: string;
  sessionId: string;
  timestamp: string;
  model?: string;
  cwd?: string;
  agentId?: string;
  usage: UsageFixture;
  speed?: string;
  iterations?: Array<{ type: string; model?: string; usage: UsageFixture }>;
}): string {
  const usage: Record<string, unknown> = { ...usageJson(options.usage), speed: options.speed ?? "standard" };
  if (options.iterations !== undefined) {
    usage["iterations"] = options.iterations.map((iteration) => ({
      ...usageJson(iteration.usage),
      type: iteration.type,
      ...(iteration.model === undefined ? {} : { model: iteration.model }),
    }));
  }
  return JSON.stringify({
    type: "assistant",
    sessionId: options.sessionId,
    timestamp: options.timestamp,
    cwd: options.cwd ?? "/work/sample-project",
    ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
    message: {
      id: options.messageId,
      model: options.model ?? "claude-opus-5-5",
      role: "assistant",
      content: [{ type: "text", text: "synthetic" }],
      usage,
    },
  });
}

export function taskNotificationLine(options: { sessionId: string; agentId: string; status: string }): string {
  return JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    sessionId: options.sessionId,
    timestamp: "2026-11-26T00:00:00.000Z",
    content: `<task-notification>\n<task-id>${options.agentId}</task-id>\n<status>${options.status}</status>\n<summary>synthetic</summary>\n</task-notification>`,
  });
}

export function agentResultLine(options: { sessionId: string; agentId: string; status: string }): string {
  return JSON.stringify({
    type: "user",
    sessionId: options.sessionId,
    timestamp: "2026-11-26T00:00:00.000Z",
    message: { role: "user", content: [{ type: "tool_result", content: "synthetic" }] },
    toolUseResult: { agentId: options.agentId, status: options.status },
  });
}

export function titleLine(options: { sessionId: string; title: string }): string {
  return JSON.stringify({ type: "ai-title", sessionId: options.sessionId, aiTitle: options.title });
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `usage-board-${prefix}-`));
}

export async function writeLines(file: string, lines: string[], modifiedMs?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, lines.map((line) => `${line}\n`).join(""));
  if (modifiedMs !== undefined) await utimes(file, new Date(modifiedMs), new Date(modifiedMs));
}

export async function appendText(file: string, text: string): Promise<void> {
  await appendFile(file, text);
}
