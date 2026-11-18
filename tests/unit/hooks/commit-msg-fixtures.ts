/**
 * Shared fixtures for the commit-msg hook regression suites: the paths and
 * trailer literals they assert on, and the temp-project harness that runs the
 * real hook against a fake commitlint binary.
 * @module tests/unit/hooks/commit-msg-fixtures
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

export const HOOK_PATH = path.resolve(".husky/commit-msg");
export const TEMPLATE_HOOK_PATH = path.resolve(
  "typescript/copy-contents/.husky/commit-msg"
);
export const BASH_PATH = "/bin/bash";
// git runs hooks through `sh`, not bash, and the two disagree about `echo`:
// bash prints `a\cb` verbatim while sh honours the XSI meaning of `\c` and
// stops output there. Tests that only ever run the hook under bash therefore
// cannot see any shell-portability defect, which is how #2143 survived.
export const SH_PATH = "/bin/sh";
const GIT_PATH = resolveGit();
export const VALID_SUBJECT = "fix: clarify hook output";
export const PASSING_COMMITLINT_BIN = "exit 0\n";
export const CLAUDE_AGENT_TRAILER = "AI-Agent: Claude";
export const CLAUDE_TRAILER = "Co-authored-by: Claude <noreply@anthropic.com>";
export const DEVIN_TRAILER = "Co-authored-by: Devin <devin@cognition.ai>";
export const HUMAN_TRAILER = "Co-authored-by: Jane Doe <jane@example.com>";
export const OPENCODE_TRAILER =
  "Co-authored-by: OpenCode <noreply@opencode.ai>";
export const OPENCODE_AGENT_TRAILER = "AI-Agent: OpenCode";
export const DEVIN_AGENT_TRAILER = "AI-Agent: Devin";
export const DEVIN_MODEL_TRAILER = "AI-Model: cognition/swe-2";
export const DEVIN_EFFORT_TRAILER = "AI-Effort: not exposed by runtime";
export const OPENCODE_MODEL_HINT = "AI-Model: <provider/model>";
export const OPENCODE_EFFORT_HINT = "AI-Effort: <effort or runtime value>";
const WORK_ITEM_REF = "acme/widgets#42";
export const WORK_ITEM_TRAILER = `Work-Item: ${WORK_ITEM_REF}`;
const TRACKER_SCRIPT = path.resolve(
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);
/**
 * The directory the tracker reaches into for its shared modules.
 *
 * A directory, not a file. This named `lib/invoked-as-script.mjs` and stopped
 * being a faithful copy the moment the tracker imported a second sibling
 * (CodySwannGT/lisa#2980) — the fixture then failed with an
 * ERR_MODULE_NOT_FOUND inside `node_modules/@codyswann/lisa/…`, which reads as
 * the published package missing a file rather than as the fixture naming what
 * it should have read. CodySwannGT/lisa#3082.
 */
const ENTRY_GUARD_DIR = path.resolve("all/copy-overwrite/scripts/lib");

/** Options for building a temporary commit-msg hook project. */
export type ProjectOptions = {
  readonly binName: string;
  readonly binBody: string;
  readonly message: string;
};

/**
 * Create a temporary git project wired to a fake package-manager binary.
 * The caller owns cleanup of the returned directory.
 * @param options - Project setup options.
 * @param baseEnv - Environment the git commands inherit (scrubbed of git vars).
 * @returns The temporary project directory.
 */
export function createProject(
  options: ProjectOptions,
  baseEnv: NodeJS.ProcessEnv
): string {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-commit-msg-"));
  const gitEnv = cleanGitEnv(baseEnv);
  mkdirSync(path.join(project, "node_modules", ".bin"), { recursive: true });
  mkdirSync(path.join(project, "scripts/lib"), { recursive: true });
  writeFileSync(path.join(project, "package-lock.json"), "{}\n");
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    '{"tracker":"github","github":{"org":"acme","repo":"widgets"}}\n'
  );
  writeFileSync(path.join(project, "COMMIT_EDITMSG"), options.message);
  copyFileSync(
    TRACKER_SCRIPT,
    path.join(project, "scripts/lisa-work-item.mjs")
  );
  // Every shared module the tracker imports. Missing one turns every
  // diagnostic this suite asserts on into an ERR_MODULE_NOT_FOUND stack.
  cpSync(ENTRY_GUARD_DIR, path.join(project, "scripts/lib"), {
    recursive: true,
  });
  writeBin(project, options.binName, options.binBody);
  writeBin(
    project,
    "gh",
    `if [ "\${1:-} \${2:-}" = "api graphql" ]; then
  printf '%s\\n' '{"data":{"repository":{"issue":{"subIssues":{"nodes":[]}}}}}'
else
  printf '%s\\n' '{"number":42,"url":"https://github.com/acme/widgets/issues/42","state":"OPEN","labels":[{"name":"status:in-progress"},{"name":"type:Task"}],"comments":[],"closedByPullRequestsReferences":[]}'
fi\n`
  );
  boundedSpawnSync({
    label: "git init",
    command: GIT_PATH,
    args: ["init"],
    cwd: project,
    env: gitEnv,
  });
  boundedSpawnSync({
    label: "git checkout -b",
    command: GIT_PATH,
    args: ["checkout", "-b", "codex/issue-1264"],
    cwd: project,
    env: gitEnv,
  });
  return project;
}

/**
 * Run the real commit-msg hook against the temp project's commit message.
 * @param project - Temporary project directory.
 * @param baseEnv - Environment the hook inherits; its PATH is extended.
 * @param shell - Interpreter to run the hook under; `sh` matches what git uses.
 * @param hookPath - Installed hook or source template to execute.
 * @returns The completed hook process.
 */
export function runHook(
  project: string,
  baseEnv: NodeJS.ProcessEnv,
  shell: string = BASH_PATH,
  hookPath: string = HOOK_PATH
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: "commit-msg hook",
    command: shell,
    args: [hookPath, "COMMIT_EDITMSG"],
    cwd: project,
    env: cleanGitEnv(baseEnv, {
      PATH: `${path.join(project, "node_modules", ".bin")}:${baseEnv.PATH}`,
    }),
  });
}

/**
 * Write an executable fake binary into the temp project's local bin directory.
 * @param project - Temporary project directory.
 * @param name - Binary filename.
 * @param body - Shell body to execute after the shebang.
 */
function writeBin(project: string, name: string, body: string): void {
  const binPath = path.join(project, "node_modules", ".bin", name);
  writeFileSync(binPath, `#!/usr/bin/env bash\n${body}`);
  chmodSync(binPath, 0o755);
}
