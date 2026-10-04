import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const ANONYMOUS_HOST = "<anonymous-host>";
const executables = {
  node: process.execPath,
  bash: "/bin/bash",
  git: "/opt/homebrew/bin/git",
};
const evidence = path.join(root, ".lisa/evidence/4335");
const host = await mkdtemp(path.join(tmpdir(), "lisa-4335-anonymous-host-"));
const oldRevision = "ad7454e02b6420a09fd7d90139d04cbb4839fae4";
const savedText = await readFile(
  path.join(evidence, "red-saved-hooks.json"),
  "utf8"
);
const saved = JSON.parse(savedText);
const commands = ["PreToolUse", "PostToolUse"].flatMap(event =>
  saved.hooks[event].flatMap(group =>
    group.hooks.map(hook => ({
      event,
      matcher: group.matcher,
      command: hook.command,
      id: hook._lisaId,
    }))
  )
);
const hash = data => createHash("sha256").update(data).digest("hex");
const sourceHashes = { "historical/hooks.json": hash(savedText) };
const redact = value =>
  value
    .replaceAll(`/private${host}`, ANONYMOUS_HOST)
    .replaceAll(host, ANONYMOUS_HOST)
    .replaceAll(root, "<lisa-worktree>");
/**
 * Run the saved commands through verified local executables.
 * @param command Executable identifier from the fixed local map.
 * @param args Exact command arguments.
 * @param input Safe stdin payload.
 * @returns Actual exit status and sanitized command streams.
 */
function run(command, args, input) {
  const out = spawnSync(
    "/usr/bin/env",
    ["LISA_BOOTSTRAP=1", executables[command], ...args],
    {
      cwd: host,
      input,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  return {
    command: redact([command, ...args].join(" ")),
    status: out.status,
    signal: out.signal,
    stdout: redact(out.stdout ?? ""),
    stderr: redact(out.stderr ?? ""),
  };
}
await mkdir(path.join(host, ".codex/hooks/lisa"), { recursive: true });
await mkdir(path.join(host, "node_modules/@codyswann"), { recursive: true });
await symlink(root, path.join(host, "node_modules/@codyswann/lisa"), "dir");
await writeFile(
  path.join(host, "package.json"),
  JSON.stringify({
    name: "anonymous-host",
    version: "1.0.0",
    private: true,
    devDependencies: { "@codyswann/lisa": "4.68.0" },
  })
);
await writeFile(
  path.join(host, "Gemfile"),
  'source "https://rubygems.org"\ngem "rails", "~> 8.0"\n'
);
await writeFile(
  path.join(host, ".lisa.config.json"),
  JSON.stringify({
    harness: "codex",
    tracker: "github",
    github: { org: "example", repo: "host-app" },
    deploy: { branches: { production: "main" } },
  })
);
await writeFile(path.join(host, ".codex/hooks.json"), savedText);
const scripts = [
  ...commands.map(command => `${command.id}.sh`),
  "_extract-edit-paths.sh",
];
for (const script of scripts) {
  const route = `repos/CodySwannGT/lisa/contents/src/codex/scripts/${script}?ref=${oldRevision}`;
  const fetched = spawnSync(
    "/opt/homebrew/bin/gh",
    ["api", route, "--jq", ".content"],
    {
      encoding: "utf8",
    }
  );
  if (fetched.status !== 0)
    throw new Error(`Historical public script read failed: ${fetched.stderr}`);
  const source = Buffer.from(fetched.stdout.replaceAll("\n", ""), "base64");
  await writeFile(path.join(host, ".codex/hooks/lisa", script), source);
  sourceHashes[`2.217.1/${script}`] = hash(source);
}
const gitInit = run("git", ["init", "--initial-branch=main"]);
const before = commands.map(command => ({
  ...command,
  ...run("bash", ["-c", command.command], "{}\n"),
}));
const apply = run("node", [
  path.join(root, "dist/index.js"),
  "--no-update-check",
  "apply",
  host,
  "--yes",
  "--skip-git-check",
  "--refresh-templates",
  "--harness",
  "codex",
]);
const after = commands.map(command => ({
  ...command,
  ...run("bash", ["-c", command.command], "{}\n"),
}));
for (const file of [
  "dist/index.js",
  "dist/codex/project-hooks-cleanup.js",
  "dist/codex/enforcement-fallback-installer.js",
])
  sourceHashes[file] = hash(await readFile(path.join(root, file)));
const report = {
  captured_at: new Date().toISOString(),
  base_sha: "728d35afbd3de4d522023e0b65fd0f730c94820c",
  legacy_version: "2.217.1",
  legacy_source_revision: oldRevision,
  host: ANONYMOUS_HOST,
  gitInit,
  payload: "{}\n",
  sourceHashes,
  before,
  apply,
  after,
  generatedHooks: JSON.parse(
    await readFile(path.join(host, ".codex/hooks.json"), "utf8")
  ),
  redEstablished:
    apply.status === 0 &&
    after.every(
      out =>
        out.status === 127 && out.stderr.includes("No such file or directory")
    ),
};
await writeFile(
  path.join(evidence, "red-results.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
await writeFile(
  path.join(evidence, "red-commands.json"),
  `${JSON.stringify(commands, null, 2)}\n`
);
await writeFile(
  path.join(evidence, "red-apply.txt"),
  apply.stdout + apply.stderr
);
console.log(
  JSON.stringify(
    {
      host,
      apply_status: apply.status,
      before: before.map(({ id, status }) => ({ id, status })),
      after: after.map(({ id, status, stderr }) => ({ id, status, stderr })),
      redEstablished: report.redEstablished,
    },
    null,
    2
  )
);
if (!report.redEstablished) process.exitCode = 1;
