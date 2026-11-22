#!/usr/bin/env bash
# Thin adapter; the same task decision owns plugin and fallback enforcement.
set -uo pipefail
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'tool-missing: Install the documented Node runtime before affected work.' >&2
  exit 2
fi
# Package-backed on host projects; plugin and OpenCode installs carry the sibling.
exec node --input-type=module -e '
import { readFileSync, existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
try {
  const input = readFileSync(0, "utf8");
  const event = JSON.parse(input);
  const root = event.cwd ?? process.cwd();
  const candidates = [
    join(dirname(process.argv[1]), "task-readiness-guard.mjs"),
    join(root, "plugins/lisa/hooks/task-readiness-guard.mjs"),
    join(root, "node_modules/@codyswann/lisa/plugins/lisa/hooks/task-readiness-guard.mjs")
  ];
  const owner = candidates.find(path => existsSync(path));
  if (owner) {
    const result = spawnSync(process.execPath, [owner], {
      input, cwd: root, encoding: "utf8", timeout: 120000,
      killSignal: "SIGKILL", maxBuffer: 1048576
    });
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.status === 0 ? 0 : 2;
  } else if (!["Read", "Glob", "Grep", "read", "glob", "grep"].includes(event.tool_name) &&
    !(event.tool_name === "Bash" && ["pwd", "ls -la", "git status --short", "git status --porcelain=v1", "git rev-parse HEAD"].includes(event.tool_input?.command))) {
    const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-path", "lisa/work-item.json"], {
      cwd: root, encoding: "utf8", timeout: 2000, killSignal: "SIGKILL"
    });
    const [project, binding] = git.status === 0 ? git.stdout.trim().split("\n") : [];
    const declared = path => {
      try { lstatSync(path); return true; }
      catch (error) { return !["ENOENT", "ENOTDIR"].includes(error.code); }
    };
    const scopeFiles = [".lisa/work-item-context.md", ".lisa.config.json", ".lisa.config.local.json"];
    const active = [root, project].some(dir => dir && scopeFiles.some(file => declared(join(dir, file)))) || (binding && declared(binding));
    if (active) {
      console.error("tool-missing: Update the installed Lisa readiness tool before affected work.");
      process.exitCode = 2;
    }
  }
} catch {
  console.error("requirements-stale: Refresh complete task requirements before affected work.");
  process.exitCode = 2;
}
' "${BASH_SOURCE[0]}"
