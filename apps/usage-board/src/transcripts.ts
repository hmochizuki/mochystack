import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isObject, numberAt, objectAt, parseJson, stringAt, type JsonObject } from "./json.ts";
import type { Billing, TokenCounts } from "./pricing.ts";

export type UsageRecord = {
  messageId: string;
  sessionId: string;
  timestampMs: number;
  project: string | null;
  billings: Billing[];
};

export type TranscriptStore = {
  readonly warm: boolean;
  refresh(nowMs: number): Promise<void>;
  usageRecords(): Iterable<UsageRecord>;
  agentOutcome(agentId: string): string | undefined;
  sessionTitle(sessionId: string): string | undefined;
};

type Cursor = { offset: number };

type Facts = {
  records: Map<string, UsageRecord>;
  agentOutcomes: Map<string, string>;
  titles: Map<string, string>;
};

const chunkBytes = 16 * 1024 * 1024;

function tokenCounts(usage: JsonObject): TokenCounts {
  const cacheWrite = numberAt(usage, "cache_creation_input_tokens") ?? 0;
  const cacheWrite1h = numberAt(objectAt(usage, "cache_creation") ?? {}, "ephemeral_1h_input_tokens") ?? 0;
  return {
    input: numberAt(usage, "input_tokens") ?? 0,
    output: numberAt(usage, "output_tokens") ?? 0,
    cacheWrite5m: Math.max(cacheWrite - cacheWrite1h, 0),
    cacheWrite1h,
    cacheRead: numberAt(usage, "cache_read_input_tokens") ?? 0,
  };
}

function billingsOf(message: JsonObject, usage: JsonObject): Billing[] | undefined {
  const model = stringAt(message, "model");
  if (model === undefined || model === "<synthetic>") return undefined;
  const speed = stringAt(usage, "speed") ?? "standard";
  const iterations = usage["iterations"];
  if (!Array.isArray(iterations) || iterations.length === 0) {
    return [{ model, speed, tokens: tokenCounts(usage) }];
  }
  return iterations
    .filter(isObject)
    .map((iteration) => ({ model: stringAt(iteration, "model") ?? model, speed, tokens: tokenCounts(iteration) }));
}

function usageRecordOf(line: JsonObject): UsageRecord | undefined {
  const message = objectAt(line, "message");
  const usage = message && objectAt(message, "usage");
  const messageId = message && stringAt(message, "id");
  const sessionId = stringAt(line, "sessionId");
  const timestampMs = Date.parse(stringAt(line, "timestamp") ?? "");
  if (message === undefined || usage === undefined || messageId === undefined || sessionId === undefined) return undefined;
  if (Number.isNaN(timestampMs)) return undefined;
  const billings = billingsOf(message, usage);
  if (billings === undefined) return undefined;
  const cwd = stringAt(line, "cwd");
  const fromMainTranscript = stringAt(line, "agentId") === undefined;
  return { messageId, sessionId, timestampMs, project: fromMainTranscript && cwd ? basename(cwd) : null, billings };
}

function readFacts(text: string, facts: Facts): void {
  if (text.includes('"type":"assistant"')) {
    const line = parseJson(text);
    const record = isObject(line) ? usageRecordOf(line) : undefined;
    if (record !== undefined) facts.records.set(record.messageId, record);
    return;
  }
  if (text.includes("<task-notification>") && text.includes('"type":"queue-operation"')) {
    const line = parseJson(text);
    const content = isObject(line) ? stringAt(line, "content") : undefined;
    const agentId = content?.match(/<task-id>([^<]+)<\/task-id>/)?.[1];
    const status = content?.match(/<status>([^<]+)<\/status>/)?.[1];
    if (agentId !== undefined && status !== undefined) facts.agentOutcomes.set(agentId, status);
    return;
  }
  if (text.includes('"toolUseResult"') && text.includes('"status":"completed"')) {
    const line = parseJson(text);
    const result = isObject(line) ? objectAt(line, "toolUseResult") : undefined;
    const agentId = result && stringAt(result, "agentId");
    if (agentId !== undefined && result !== undefined && stringAt(result, "status") === "completed") {
      facts.agentOutcomes.set(agentId, "completed");
    }
    return;
  }
  if (text.includes('"type":"ai-title"')) {
    const line = parseJson(text);
    const sessionId = isObject(line) ? stringAt(line, "sessionId") : undefined;
    const title = isObject(line) ? stringAt(line, "aiTitle") : undefined;
    if (sessionId !== undefined && title !== undefined) facts.titles.set(sessionId, title);
  }
}

async function readCompleteLines(file: string, cursor: Cursor, size: number, onLine: (line: string) => void): Promise<void> {
  const handle = await open(file, "r");
  try {
    let position = cursor.offset;
    let carry = Buffer.alloc(0);
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(chunkBytes, size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      const lastNewline = data.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        carry = data;
        continue;
      }
      for (const line of data.subarray(0, lastNewline).toString("utf8").split("\n")) onLine(line);
      carry = data.subarray(lastNewline + 1);
    }
    cursor.offset = position - carry.length;
  } finally {
    await handle.close();
  }
}

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => join(dir, entry.name));
}

async function transcriptFiles(projectsDir: string): Promise<string[]> {
  const projects = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const perProject = await Promise.all(
    projects
      .filter((entry) => entry.isDirectory())
      .map(async (project) => {
        const projectDir = join(projectsDir, project.name);
        const entries = await readdir(projectDir, { withFileTypes: true }).catch(() => []);
        const subagentFiles = await Promise.all(
          entries.filter((entry) => entry.isDirectory()).map((entry) => jsonlFiles(join(projectDir, entry.name, "subagents"))),
        );
        return [...(await jsonlFiles(projectDir)), ...subagentFiles.flat()];
      }),
  );
  return perProject.flat();
}

export function createTranscriptStore(options: { projectsDir: string; windowMs: number }): TranscriptStore {
  const cursors = new Map<string, Cursor>();
  const facts: Facts = { records: new Map(), agentOutcomes: new Map(), titles: new Map() };
  let warm = false;
  let inFlight: Promise<void> | undefined;

  async function readFile(file: string, windowStartMs: number): Promise<void> {
    const info = await stat(file).catch(() => undefined);
    if (info === undefined || info.mtimeMs < windowStartMs) return;
    const cursor = cursors.get(file) ?? { offset: 0 };
    cursors.set(file, cursor);
    if (info.size < cursor.offset) cursor.offset = 0;
    if (info.size === cursor.offset) return;
    await readCompleteLines(file, cursor, info.size, (line) => readFacts(line, facts)).catch(() => undefined);
  }

  async function run(nowMs: number): Promise<void> {
    const windowStartMs = nowMs - options.windowMs;
    for (const file of await transcriptFiles(options.projectsDir)) {
      await readFile(file, windowStartMs);
    }
    for (const [messageId, record] of facts.records) {
      if (record.timestampMs < windowStartMs) facts.records.delete(messageId);
    }
    warm = true;
  }

  return {
    get warm() {
      return warm;
    },
    refresh(nowMs) {
      inFlight ??= run(nowMs).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
    usageRecords: () => facts.records.values(),
    agentOutcome: (agentId) => facts.agentOutcomes.get(agentId),
    sessionTitle: (sessionId) => facts.titles.get(sessionId),
  };
}
