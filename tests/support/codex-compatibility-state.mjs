/** Replay loaded historical commands across normal explicit full apply. */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const ANONYMOUS_HOST = "<anonymous-host>";
const INSTALLED_LISA = "node_modules/@codyswann/lisa";
const root = process.cwd();
const evidence =
  process.env.LISA_COMPAT_EVIDENCE ?? path.join(root, ".lisa/evidence/4335");
await mkdir(evidence, { recursive: true });
const host = await mkdtemp(path.join(tmpdir(), "lisa-4335-green-anonymous-"));
const saved = JSON.parse(
  await readFile(
    path.join(root, ".lisa/evidence/4335/red-saved-hooks.json"),
    "utf8"
  )
);
const commands = Object.entries(saved.hooks).flatMap(([event, groups]) =>
  groups.flatMap(group =>
    group.hooks.map(hook => ({
      event,
      id: hook._lisaId,
      command: hook.command,
    }))
  )
);
const redact = str =>
  str
    .replaceAll(`/private${host}`, ANONYMOUS_HOST)
    .replaceAll(host, ANONYMOUS_HOST)
    .replaceAll(root, "<lisa-worktree>");
/**
 * Run a bounded host process and sanitize its captured streams.
 * @param command Executable.
 * @param args Arguments.
 * @param input Safe stdin.
 * @param extraEnv Subprocess environment additions.
 * @returns Actual status and streams.
 */
function run(command, args, input, extraEnv = {}) {
  const out = spawnSync(command, args, {
    cwd: host,
    input,
    encoding: "utf8",
    env: { ...process.env, LISA_BOOTSTRAP: "1", ...extraEnv },
    maxBuffer: 24 * 1024 * 1024,
    timeout: 240000,
  });
  return {
    command: redact([command, ...args].join(" ")),
    status: out.status,
    signal: out.signal,
    stdout: redact(out.stdout ?? ""),
    stderr: redact(out.stderr ?? ""),
    error: out.error?.message,
  };
}
const hash = data => createHash("sha256").update(data).digest("hex");
const sourcePaths = [
  "src/codex/hooks-installer.ts",
  "src/codex/project-hooks-cleanup.ts",
  "src/codex/project-overlay.ts",
  "dist/codex/hooks-installer.js",
];
const sourceHashesBefore = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async file => [
      file,
      hash(await readFile(path.join(root, file))),
    ])
  )
);
/**
 * Materialize one anonymous fixture file.
 * @param relative Host path.
 * @param text Contents.
 * @param mode Optional executable permission.
 */
async function output(relative, text, mode) {
  await mkdir(path.dirname(path.join(host, relative)), { recursive: true });
  await writeFile(path.join(host, relative), text, mode ? { mode } : undefined);
}
const checks = [];
/**
 * Preserve one observed contract result.
 * @param name Criterion.
 * @param passed Observed outcome.
 * @param details Actual evidence.
 */
function check(name, passed, details) {
  checks.push({ name, passed, details });
}

export {
  ANONYMOUS_HOST,
  INSTALLED_LISA,
  root,
  evidence,
  host,
  saved,
  commands,
  run,
  hash,
  sourcePaths,
  sourceHashesBefore,
  output,
  checks,
  check,
};
