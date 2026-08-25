/**
 * Regression tests for the commit-msg hook diagnostics.
 *
 * The hook should name the exact failing commitlint rule and show concrete
 * attribution trailers, so agents do not need multiple commit attempts to learn
 * what the hook wanted.
 * @module tests/unit/hooks/commit-msg
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK_PATH = path.resolve(".husky/commit-msg");
const BASH_PATH = "/bin/bash";
// git runs hooks through `sh`, not bash, and the two disagree about `echo`:
// bash prints `a\cb` verbatim while sh honours the XSI meaning of `\c` and
// stops output there. Tests that only ever run the hook under bash therefore
// cannot see any shell-portability defect, which is how #2143 survived.
const SH_PATH = "/bin/sh";
const GIT_PATH = resolveGit();
const VALID_SUBJECT = "fix: clarify hook output";
const PASSING_COMMITLINT_BIN = "exit 0\n";
const OPENCODE_TRAILER = "Co-authored-by: OpenCode <noreply@opencode.ai>";
const OPENCODE_AGENT_TRAILER = "AI-Agent: OpenCode";
const OPENCODE_MODEL_HINT = "AI-Model: <provider/model>";
const OPENCODE_EFFORT_HINT = "AI-Effort: <effort or runtime value>";
const WORK_ITEM_REF = "acme/widgets#42";
const WORK_ITEM_TRAILER = `Work-Item: ${WORK_ITEM_REF}`;
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

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

describe("commit-msg hook diagnostics", () => {
  it("names the failed commitlint rule and offending subject", () => {
    const project = createProject({
      binName: "npx",
      binBody: [
        "printf '%s\\n' 'input: Fix Bad Subject'",
        "printf '%s\\n' '✖   subject must not be sentence-case, start-case, pascal-case, upper-case [subject-case]'",
        "exit 1",
      ].join("\n"),
      message: [
        "Fix Bad Subject",
        "",
        WORK_ITEM_TRAILER,
        "Co-authored-by: Codex <codex@openai.com>",
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Failed commitlint rule(s):");
    expect(result.stdout).toContain("[subject-case]");
    expect(result.stdout).toContain("Subject: Fix Bad Subject");
  });

  it("prints exact expected attribution trailers", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Expected one of these trailers:");
    expect(result.stdout).toContain(
      "Co-authored-by: Claude <noreply@anthropic.com>"
    );
    expect(result.stdout).toContain("Co-authored-by: Codex <codex@openai.com>");
    expect(result.stdout).toContain(OPENCODE_TRAILER);
    expect(result.stdout).toContain(OPENCODE_AGENT_TRAILER);
    expect(result.stdout).toContain(OPENCODE_MODEL_HINT);
    expect(result.stdout).toContain(OPENCODE_EFFORT_HINT);
  });

  it("accepts OpenCode attribution with model and effort metadata", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        OPENCODE_TRAILER,
        OPENCODE_AGENT_TRAILER,
        "AI-Model: openai/gpt-5.5",
        "AI-Effort: not exposed by runtime",
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("rejects OpenCode attribution without model and effort metadata", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        OPENCODE_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "OpenCode commits must include AI metadata trailers"
    );
    expect(result.stdout).toContain(OPENCODE_AGENT_TRAILER);
    expect(result.stdout).toContain(OPENCODE_MODEL_HINT);
    expect(result.stdout).toContain(OPENCODE_EFFORT_HINT);
  });
});

/**
 *
 */
type ProjectOptions = {
  readonly binName: string;
  readonly binBody: string;
  readonly message: string;
};

/**
 * Create a temporary git project wired to a fake package-manager binary.
 * @param options - Project setup options.
 * @returns The temporary project directory.
 */
function createProject(options: ProjectOptions): string {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-commit-msg-"));
  const gitEnv = cleanGitEnv(process.env);
  tempDirs.push(project);
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
 * @param shell - Interpreter to run the hook under; `sh` matches what git uses.
 * @returns The completed hook process.
 */
function runHook(
  project: string,
  shell: string = BASH_PATH
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: "commit-msg hook",
    command: shell,
    args: [HOOK_PATH, "COMMIT_EDITMSG"],
    cwd: project,
    env: cleanGitEnv(process.env, {
      PATH: `${path.join(project, "node_modules", ".bin")}:${process.env.PATH}`,
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

describe("commit message content cannot break the hook's own parsing", () => {
  const BACKSLASH_C_SUBJECT = String.raw`fix: use \copy for the bulk load`;

  it("accepts a valid trailer after a subject containing an XSI escape", () => {
    // Run under `sh`, deliberately. Under bash this passes with or without the
    // fix, so a bash-only assertion here would be a test that cannot fail.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        BACKSLASH_C_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        "Co-authored-by: Claude <noreply@anthropic.com>",
        "",
      ].join("\n"),
    });

    const result = runHook(project, SH_PATH);

    // The trailer is present and correctly formed. Rejecting here means the
    // hook truncated the message before matching, then blamed the trailer.
    expect(result.stdout).not.toContain("must include AI co-authorship");
    expect(result.status).toBe(0);
  });

  it("still rejects a message that genuinely lacks a trailer", () => {
    // The control: the fix must not turn the co-authorship gate into a pass.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: `${BACKSLASH_C_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n`,
    });

    const result = runHook(project, SH_PATH);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("must include AI co-authorship");
  });
});
