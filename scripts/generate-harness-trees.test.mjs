import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./generate-harness-trees.mjs", import.meta.url));
const CORE = fileURLToPath(new URL("../core", import.meta.url));

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "harness-trees-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(CORE, join(root, "core"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  cpSync(SCRIPT, join(root, "scripts", "generate-harness-trees.mjs"));
  return root;
}

function addSkill(root, name, { frontmatter = "", body = "" } = {}) {
  mkdirSync(join(root, "core", "skills", name));
  writeFileSync(
    join(root, "core", "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Fixture.\n${frontmatter}---\n\n# Fixture\n\n${body}\n`,
  );
}

function generate(root) {
  return spawnSync(process.execPath, [join(root, "scripts", "generate-harness-trees.mjs")], { encoding: "utf8" });
}

function read(root, path) {
  return readFileSync(join(root, path), "utf8");
}

test("the Codex tree ships a Codex plugin manifest and only the Codex adapter", (t) => {
  const root = workspace(t);
  assert.equal(generate(root).status, 0);
  const manifest = read(root, "core/plugin.json");
  assert.equal(read(root, "dist/codex/.codex-plugin/plugin.json"), manifest);
  assert.equal(read(root, "dist/codex/plugin.json"), manifest);
  assert.equal(existsSync(join(root, "dist/codex/.claude-plugin")), false);
  assert.equal(existsSync(join(root, "dist/codex/docs/harness/codex.md")), true);
  assert.equal(existsSync(join(root, "dist/codex/docs/harness/claude-code.md")), false);
  assert.equal(existsSync(join(root, "dist/claude-code/docs/harness/codex.md")), false);
});

test("a skill that disables model invocation is explicit-only in Codex", (t) => {
  const root = workspace(t);
  addSkill(root, "fixture-explicit", { frontmatter: "disable-model-invocation: true\n" });
  addSkill(root, "fixture-implicit");
  assert.equal(generate(root).status, 0);
  assert.equal(
    read(root, "dist/codex/skills/fixture-explicit/agents/openai.yaml"),
    "policy:\n  allow_implicit_invocation: false\n",
  );
  assert.equal(existsSync(join(root, "dist/codex/skills/fixture-implicit/agents/openai.yaml")), false);
  assert.equal(existsSync(join(root, "dist/claude-code/skills/fixture-explicit/agents")), false);
});

test("a skill that uses Cursor names points at the adapter of its own tree", (t) => {
  const root = workspace(t);
  addSkill(root, "fixture-task", { body: "Spawn a `Task` subagent." });
  assert.equal(generate(root).status, 0);
  assert.match(
    read(root, "dist/codex/skills/fixture-task/SKILL.md"),
    /^# Fixture\n\nIn Codex, read \[the Codex adapter\]\(\.\.\/\.\.\/docs\/harness\/codex\.md\) once per session/m,
  );
  assert.match(
    read(root, "dist/claude-code/skills/fixture-task/SKILL.md"),
    /^# Fixture\n\nIn Claude Code, read \[the Claude Code adapter\]\(\.\.\/\.\.\/docs\/harness\/claude-code\.md\)/m,
  );
});

test("generation fails when the Codex adapter has no row for a Cursor name in use", (t) => {
  const root = workspace(t);
  writeFileSync(join(root, "core/docs/harness/codex.md"), "# pstack in Codex\n");
  const run = generate(root);
  assert.equal(run.status, 1);
  assert.match(run.stdout, /FAIL Codex adapter has no row for `Task`/);
  assert.doesNotMatch(run.stdout, /FAIL Claude Code adapter/);
});
