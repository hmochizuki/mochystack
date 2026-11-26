import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isObject, numberAt, parseJson, stringAt } from "./json.ts";

export type LiveSubagent = {
  agentId: string;
  label: string;
  agentType: string | null;
  model: string | null;
  state: string;
  lastWriteMs: number;
};

export type LiveSession = {
  pid: number;
  sessionId: string;
  name: string | null;
  project: string | null;
  status: string;
  waitingFor: string | null;
  startedAtMs: number;
  statusUpdatedAtMs: number | null;
  subagents: LiveSubagent[];
};

export type LiveOptions = {
  claudeDir: string;
  nowMs: number;
  finishedVisibleMs: number;
  agentOutcome: (agentId: string) => string | undefined;
};

const statusOrder = ["waiting", "busy"];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function readJson(file: string): Promise<unknown> {
  return parseJson(await readFile(file, "utf8").catch(() => ""));
}

async function readSubagent(dir: string, agentId: string, options: LiveOptions): Promise<LiveSubagent | undefined> {
  const info = await stat(join(dir, `agent-${agentId}.jsonl`)).catch(() => undefined);
  if (info === undefined) return undefined;
  const meta = await readJson(join(dir, `agent-${agentId}.meta.json`));
  const field = (key: string) => (isObject(meta) ? stringAt(meta, key) : undefined);
  return {
    agentId,
    label: field("name") ?? field("description") ?? agentId,
    agentType: field("agentType") ?? null,
    model: field("model") ?? null,
    state: options.agentOutcome(agentId) ?? "running",
    lastWriteMs: Math.round(info.mtimeMs),
  };
}

async function readSubagents(session: LiveSession, cwd: string, options: LiveOptions): Promise<LiveSubagent[]> {
  const dir = join(options.claudeDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), session.sessionId, "subagents");
  const names = await readdir(dir).catch(() => []);
  const agentIds = names.flatMap((name) => name.match(/^agent-(.+)\.jsonl$/)?.[1] ?? []);
  const subagents = await Promise.all(agentIds.map((agentId) => readSubagent(dir, agentId, options)));
  return subagents
    .filter((subagent) => subagent !== undefined)
    .filter((subagent) => subagent.lastWriteMs >= session.startedAtMs)
    .filter((subagent) => subagent.state === "running" || subagent.lastWriteMs >= options.nowMs - options.finishedVisibleMs)
    .sort((a, b) => b.lastWriteMs - a.lastWriteMs);
}

async function readSession(file: string, options: LiveOptions): Promise<LiveSession | undefined> {
  const json = await readJson(file);
  if (!isObject(json)) return undefined;
  const pid = numberAt(json, "pid");
  const sessionId = stringAt(json, "sessionId");
  const cwd = stringAt(json, "cwd");
  if (pid === undefined || sessionId === undefined || !isAlive(pid)) return undefined;
  const session: LiveSession = {
    pid,
    sessionId,
    name: stringAt(json, "name") ?? null,
    project: cwd === undefined ? null : basename(cwd),
    status: stringAt(json, "status") ?? "unknown",
    waitingFor: stringAt(json, "waitingFor") ?? null,
    startedAtMs: numberAt(json, "startedAt") ?? 0,
    statusUpdatedAtMs: numberAt(json, "statusUpdatedAt") ?? null,
    subagents: [],
  };
  session.subagents = cwd === undefined ? [] : await readSubagents(session, cwd, options);
  return session;
}

function rank(status: string): number {
  const index = statusOrder.indexOf(status);
  return index === -1 ? statusOrder.length : index;
}

export async function readLiveSessions(options: LiveOptions): Promise<LiveSession[]> {
  const dir = join(options.claudeDir, "sessions");
  const names = await readdir(dir).catch(() => []);
  const sessions = await Promise.all(
    names.filter((name) => name.endsWith(".json")).map((name) => readSession(join(dir, name), options)),
  );
  return sessions
    .filter((session) => session !== undefined)
    .sort((a, b) => rank(a.status) - rank(b.status) || (b.statusUpdatedAtMs ?? 0) - (a.statusUpdatedAtMs ?? 0));
}
