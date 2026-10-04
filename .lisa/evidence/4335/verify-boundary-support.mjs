import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd(),
  evidence = path.join(root, ".lisa/evidence/4335");
const GIT_BIN = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
].find(existsSync);
if (!GIT_BIN) throw Error("A verified Git executable is required");
const host = await mkdtemp(
  path.join(tmpdir(), "lisa-4335-verify-anonymous-host-")
);
const tools = JSON.parse(
  await readFile(path.join(evidence, "verify-tool-location.json"), "utf8")
);
if (tools.status !== 0) throw Error("Real RuboCop prerequisite failed");
const executables = {
  node: process.execPath,
  bash: "/bin/bash",
  git: GIT_BIN,
  bundle: "/Users/cody/.local/share/mise/installs/ruby/4.0.1/bin/bundle",
};
const ANONYMOUS_HOST = "<anonymous-host>";
const HOOK_DIR = ".codex/hooks/lisa";
const INSTALLED_LISA = "node_modules/@codyswann/lisa";
const HOOKS_FILE = ".codex/hooks.json";
const SAMPLE_RB = "sample.rb";
const RUBOCOP_ID = "rubocop-on-edit";
const SCANNER_ID = "sg-scan-on-edit";
const redact = s =>
  (s ?? "")
    .replaceAll(`/private${host}`, ANONYMOUS_HOST)
    .replaceAll(host, ANONYMOUS_HOST)
    .replaceAll(tools.host, "<anonymous-tool-host>")
    .replaceAll(root, "<lisa-worktree>");
const sha = b => createHash("sha256").update(b).digest("hex");
const runs = [];
/**
 * Run the actual system with inherited environment and explicit verifier tool paths.
 * @param id Observed operation identifier.
 * @param command Verified executable name.
 * @param args Exact arguments.
 * @param input Safe stdin payload.
 * @param timeout Bounded wait in milliseconds.
 * @returns Actual status and captured sanitized streams.
 */
function run(id, command, args, input, timeout = 240000) {
  const r = spawnSync(
    "/usr/bin/env",
    [
      "LISA_BOOTSTRAP=1",
      `BUNDLE_GEMFILE=${path.join(tools.host, "Gemfile")}`,
      `BUNDLE_PATH=${tools.bundle_path}`,
      executables[command],
      ...args,
    ],
    {
      cwd: host,
      input,
      encoding: "utf8",
      timeout,
      maxBuffer: 30 * 1024 * 1024,
    }
  );
  const result = {
    id,
    command: redact([command, ...args].join(" ")),
    status: r.status,
    signal: r.signal,
    error: r.error?.message ?? null,
    stdout: redact(r.stdout),
    stderr: redact(r.stderr),
  };
  runs.push(result);
  return result;
}
const saved = await readFile(
    path.join(evidence, "red-saved-hooks.json"),
    "utf8"
  ),
  hooks = JSON.parse(saved);
const commands = JSON.parse(
  await readFile(path.join(evidence, "red-commands.json"), "utf8")
);
await mkdir(path.join(host, HOOK_DIR), { recursive: true });
await mkdir(path.join(host, "node_modules/@codyswann"), { recursive: true });
await mkdir(path.join(host, "config"), { recursive: true });
await mkdir(path.join(host, "scripts"), { recursive: true });
await symlink(root, path.join(host, INSTALLED_LISA), "dir");
await mkdir(path.join(host, "node_modules/.bin"), { recursive: true });
await symlink(
  path.join(root, "node_modules/.bin/ast-grep"),
  path.join(host, "node_modules/.bin/ast-grep")
);
await writeFile(
  path.join(host, "config/application.rb"),
  "# Anonymous supported Rails fixture\n"
);
await writeFile(
  path.join(host, "package.json"),
  JSON.stringify({
    name: "anonymous-host-app",
    version: "1.0.0",
    private: true,
    devDependencies: { "@codyswann/lisa": "4.68.0" },
  })
);
await writeFile(
  path.join(host, "Gemfile"),
  'source "https://rubygems.org"\ngem "rubocop", "~> 1.80"\n'
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
await writeFile(
  path.join(host, SAMPLE_RB),
  "# frozen_string_literal: true\nvalue = 1\n"
);
await writeFile(
  path.join(host, "scripts/host-hook.mjs"),
  "import{appendFileSync}from'node:fs';let p='';for await(const c of process.stdin)p+=c;appendFileSync('.native-host-hook.jsonl',JSON.stringify({event:'host-preserved',payload:JSON.parse(p)})+'\\n');\n"
);
hooks.hooks.PreToolUse.push({
  matcher: "Bash|Edit|Write|apply_patch",
  hooks: [
    { type: "command", command: "node scripts/host-hook.mjs", timeout: 10 },
  ],
});
await writeFile(
  path.join(host, HOOKS_FILE),
  `${JSON.stringify(hooks, null, 2)}\n`
);
await writeFile(
  path.join(evidence, "verify-saved-hooks.json"),
  `${JSON.stringify(hooks, null, 2)}\n`
);
await writeFile(
  path.join(evidence, "verify-saved-commands.json"),
  `${JSON.stringify(commands, null, 2)}\n`
);
const legacyPackage = path.join(
  host,
  "node_modules/@codyswann/legacy-lisa-package"
);
await mkdir(legacyPackage, { recursive: true });
const packageCapture = spawnSync(
  GIT_BIN,
  ["show", "ad7454e02b6420a09fd7d90139d04cbb4839fae4:package.json"],
  { cwd: root }
);
if (packageCapture.status !== 0)
  throw Error("Historical Lisa package metadata unavailable");
const historicalPackage = JSON.parse(packageCapture.stdout.toString());
if (
  historicalPackage.name !== "@codyswann/lisa" ||
  historicalPackage.version !== "2.217.0"
)
  throw Error(
    "Historical Lisa package identity differs from verified migration input"
  );
await writeFile(
  path.join(legacyPackage, "package.json"),
  packageCapture.stdout
);
await writeFile(
  path.join(evidence, "verify-historical-package-identity.json"),
  `${JSON.stringify(
    {
      git_object: "ad7454e02b6420a09fd7d90139d04cbb4839fae4:package.json",
      name: historicalPackage.name,
      version: historicalPackage.version,
      sha256: sha(packageCapture.stdout),
    },
    null,
    2
  )}\n`
);
const legacyScripts = path.join(legacyPackage, "dist/codex/scripts");
await mkdir(legacyScripts, { recursive: true });
for (const script of [
  ...commands.map(c => `${c.id}.sh`),
  "_extract-edit-paths.sh",
]) {
  const fetched = spawnSync(
    GIT_BIN,
    [
      "show",
      `ad7454e02b6420a09fd7d90139d04cbb4839fae4:src/codex/scripts/${script}`,
    ],
    { cwd: root }
  );
  if (fetched.status !== 0) throw Error(`Historical source missing: ${script}`);
  const legacy = path.join(legacyScripts, script);
  await writeFile(legacy, fetched.stdout);
  await symlink(legacy, path.join(host, HOOK_DIR, script));
}
run("git-init", "git", ["init", "--initial-branch=main"]);
run("git-track-host-files", "git", [
  "add",
  SAMPLE_RB,
  "scripts/host-hook.mjs",
  "config/application.rb",
]);
commands.forEach(c => run(`before-${c.id}`, "bash", ["-c", c.command], "{}\n"));

export {
  GIT_BIN,
  root,
  evidence,
  host,
  tools,
  commands,
  legacyPackage,
  run,
  runs,
  sha,
  redact,
  ANONYMOUS_HOST,
  HOOK_DIR,
  INSTALLED_LISA,
  HOOKS_FILE,
  SAMPLE_RB,
  RUBOCOP_ID,
  SCANNER_ID,
};
