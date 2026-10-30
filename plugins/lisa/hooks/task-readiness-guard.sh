#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# Thin adapter; the same task decision owns plugin and fallback enforcement.
set -uo pipefail
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'tool-missing: Install the documented Node runtime before affected work.' >&2
  exit 2
fi
# Package-backed on host projects; plugin and OpenCode installs carry the sibling.
exec node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";
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
    !(event.tool_name === "Bash" && ["pwd", "git status --short", "git status --porcelain=v1", "git rev-parse HEAD"].includes(event.tool_input?.command))) {
    console.error("tool-missing: Update the installed Lisa readiness tool before affected work.");
    process.exitCode = 2;
  }
} catch {
  console.error("requirements-stale: Refresh complete task requirements before affected work.");
  process.exitCode = 2;
}
' "${BASH_SOURCE[0]}"
