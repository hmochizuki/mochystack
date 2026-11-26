import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { removeProfile } from "./chrome.ts";
import { tempDir } from "./fixtures.ts";

const lingeringWriter = `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const [dir, durationMs] = process.argv.slice(1);
const deadline = Date.now() + Number(durationMs);
let index = 0;
writeFileSync(join(dir, "first"), "x");
process.stdout.write("ready\\n");
while (Date.now() < deadline) {
  try {
    writeFileSync(join(dir, \`file-\${index}\`), "x");
  } catch {}
  index += 1;
}
`;

test("Chrome を閉じたあとも子プロセスがプロファイルに書き込んでいても、書き込みが止まればプロファイルを消しきる", async () => {
  const profile = await tempDir("profile");
  const busy = join(profile, "Default");
  await mkdir(busy);
  const writer = spawn(process.execPath, ["-e", lingeringWriter, busy, "500"], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((resolve) => writer.once("exit", resolve));
  await new Promise((resolve) => writer.stdout.once("data", resolve));
  try {
    await removeProfile(profile);
  } finally {
    await exited;
  }
  assert.equal(existsSync(profile), false);
});
